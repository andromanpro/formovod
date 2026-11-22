"""Local visual MCP for operating a 1C web client through a managed Chromium tab."""
import argparse
import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar
import json
import os
from pathlib import Path
import re
import shutil
from tempfile import TemporaryDirectory
from typing import Any, Literal
from urllib.parse import quote, urlsplit
from uuid import uuid4

from mcp.server.fastmcp import FastMCP, Image
from playwright.async_api import async_playwright

from live_preview import LivePreview
from publications import publication,in_publication,ONE_C_META


HERE = Path(__file__).resolve().parent
DEMO = 'http://127.0.0.1:18093/live/ru_RU/'
SURFACE = ('args => {\n' + (HERE / 'extension' / 'visible-rect.js').read_text(encoding='utf-8') +
           '\nreturn (' + (HERE / 'surface.js').read_text(encoding='utf-8') + ')(args);\n}')
Actor = Literal['entry', 'contract', 'check', 'price', 'product', 'gtd', 'counterparty', 'quantity', 'quote']
Payload = dict[str, Any]
Key = Literal['Enter', 'Tab', 'Shift+Tab', 'Control+s', 'Control+f', 'Escape', 'Space',
              'F2', 'F4', 'Shift+F4', 'Control+Shift+F4', 'F6', 'F9',
              'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
              'Home', 'End', 'Control+Home', 'Control+End', 'PageUp', 'PageDown', 'Backspace', 'Delete']
Kind = Literal['button', 'tab', 'section', 'link', 'option', 'field', 'table', 'cell']
MouseAction = Literal['click', 'double_click', 'right_click', 'hover']


class WebClient:
    def __init__(self, args):
        self.args = args
        self.base,self.origin,self.path=publication(args.url) if args.url is not None else (None,None,None)
        self.initial_base=self.base
        self.base_tabs={}
        self.lock = asyncio.Lock()
        self.check_lock = asyncio.Lock()
        self.selection_lock = asyncio.Lock()
        self.browser = self.playwright = self.profile = self.tab = None
        self.preview = self.preview_url = None
        self.panel_mode = getattr(args, 'panel', False)
        self.activity_seq = 0
        self.assignment = ContextVar('formovod_assignment', default=None)
        self.call_base = ContextVar('formovod_call_base',default=None)
        self.brigade = getattr(args, 'brigade', False) or self.panel_mode
        self.live_gestures = self.brigade and not getattr(args, 'brigade_demo', False)
        self.panel = None

    async def start(self):
        if self.tab is not None and not self.tab.is_closed():
            return self.tab
        if any(not tab.is_closed() for tab in self.base_tabs.values()):
            raise ValueError('Активная вкладка закрыта. Выберите оставшуюся базу в пульте.')
        await self.stop()
        profile = TemporaryDirectory(prefix='1c-visual-mcp-', ignore_cleanup_errors=True)
        self.profile = profile
        here = Path(profile.name)
        extension = here / 'extension'
        shutil.copytree(HERE / 'extension', extension,
                        ignore=None if self.brigade else shutil.ignore_patterns('brigade*'))
        manifest = extension / 'manifest.json'
        metadata = json.loads(manifest.read_text(encoding='utf-8'))
        self.static_scope=(self.origin,self.path)
        if self.base:
            url = urlsplit(self.base)
            host=f'[{url.hostname}]' if ':' in url.hostname else url.hostname
            metadata['content_scripts'][0]['matches'] = [f'{url.scheme}://{host}{self.path}*']
            metadata['content_scripts'][0]['include_globs']=[f'{url.scheme}://{url.netloc}{self.path}*']
        if self.panel_mode:
            metadata['background']['service_worker']='managed-background.js'
            metadata['permissions'].append('storage')
            metadata['host_permissions']=['http://*/*','https://*/*']
        if self.brigade:
            scripts = ['local-dictation.js', 'panel.js'] if self.panel_mode else []
            if self.live_gestures:
                scripts += ['impact.js', 'inspection.js', 'crew-motion.js']
            metadata['content_scripts'][0]['js'][:0] = scripts + ['brigade.js']
            metadata['web_accessible_resources'] = [{
                'resources': ['brigade-assets/*.png','brigade-assets/leader-console-*.webp'],
                'matches': ['http://*/*','https://*/*'] if self.panel_mode else [f'{url.scheme}://{host}/*'],
            }]
        if self.panel_mode:
            (extension/'managed-scripts.js').write_text('const formovodScripts = '+json.dumps(metadata['content_scripts'][0]['js'])+';',encoding='utf8')
        if not self.base:metadata.pop('content_scripts')
        manifest.write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
        self.playwright = await async_playwright().start()
        window_args = [f'--disable-extensions-except={extension}', f'--load-extension={extension}']
        viewport = {'width': 1660, 'height': 960} if self.brigade else {'width': 1440, 'height': 900}
        visible_brigade = self.brigade and not self.args.headless
        if visible_brigade:
            window_args.append('--start-maximized')
        try:
            self.browser = await self.playwright.chromium.launch_persistent_context(
                str(here / 'profile'), channel='chromium', headless=self.args.headless,
                executable_path=self.args.chromium, viewport=None if visible_brigade else viewport,
                no_viewport=visible_brigade,
                ignore_default_args=['--disable-extensions'],
                args=window_args,
                record_video_dir=self.args.record_dir,
                record_video_size={'width': 1440, 'height': 900} if self.args.record_dir else None,
            )
        except BaseException:
            await self.stop()
            raise
        self.tab = self.browser.pages[0]
        if self.base:self.base_tabs[self.base]=self.tab
        return self.tab

    def page(self):
        if self.call_base.get() not in (None,self.base):
            raise ValueError('Активная база сменилась. Повторите осмотр новой базы.')
        if self.tab is None or self.tab.is_closed():
            raise ValueError('Open the 1C publication with open_1c first.')
        if not in_publication(self.tab.url,self.origin,self.path):
            raise ValueError('The tab is outside the configured 1C publication.')
        return self.tab

    async def switch_publication(self,address):
        base,origin,path=publication(address)
        async with self.lock,self.check_lock:
            candidate=self.base_tabs.get(base)
            fresh=candidate is None or candidate.is_closed()
            previous=self.tab
            if fresh:candidate=await self.browser.new_page()
            added=False
            try:
                if fresh and (origin,path)!=self.static_scope:
                    workers=[w for w in self.browser.service_workers if w.url.endswith('/managed-background.js')]
                    worker=workers[0] if workers else await self.browser.wait_for_event('serviceworker',
                        predicate=lambda w:w.url.endswith('/managed-background.js'),timeout=8000)
                    scope={'origin':'://'.join(origin),'path':path}
                    added=await worker.evaluate("""async p=>{
                        const {publications=[]}=await chrome.storage.session.get('publications');
                        if(publications.some(x=>x.origin===p.origin && x.path===p.path))return false;
                        await chrome.storage.session.set({publications:[...publications,p]});
                        return true;
                    }""",scope)
                if fresh:
                    response=await candidate.goto(base,wait_until='domcontentloaded',timeout=20000)
                    if not response or not response.ok:raise ValueError('Публикация вернула ошибку HTTP.')
                if not in_publication(candidate.url,origin,path):
                    raise ValueError('Открытая страница находится за пределами выбранной публикации.')
                await candidate.locator(ONE_C_META).wait_for(state='attached',timeout=12000)
                await candidate.locator('#formovod-brigade-dock').wait_for(state='attached',timeout=15000)
                await candidate.bring_to_front()
                if self.preview and previous is not candidate:await self.preview.bind_page(candidate)
            except BaseException:
                if added:
                    await asyncio.gather(worker.evaluate("""async p=>{
                        const {publications=[]}=await chrome.storage.session.get('publications');
                        await chrome.storage.session.set({publications:publications.filter(x=>x.origin!==p.origin || x.path!==p.path)});
                    }""",scope),return_exceptions=True)
                if fresh:await candidate.close()
                if previous and not previous.is_closed():await previous.bring_to_front()
                raise
            self.base,self.origin,self.path,self.tab=base,origin,path,candidate
            self.base_tabs[base]=candidate

    async def stop(self):
        video = self.tab.video if self.tab is not None else None
        try:
            if self.panel:
                await self.panel.stop()
            if self.preview is not None:
                await self.preview.stop()
            if self.browser is not None:
                await self.browser.close()
            return str(await video.path()) if video else None
        finally:
            if self.playwright is not None:
                await self.playwright.stop()
            if self.profile is not None:
                self.profile.cleanup()
            self.browser = self.playwright = self.profile = self.tab = None
            self.base_tabs.clear()
            self.preview = self.preview_url = None

    async def open(self, link):
        if link and (not link.startswith('e1cib/') or any(ord(c) < 32 for c in link) or len(link) > 1000):
            raise ValueError('Pass an internal e1cib/ link from the configured publication.')
        await self.require_running()
        page = await self.start()
        reply=await page.goto(self.base + ('#' + quote(link, safe='/._?=&-') if link else ''),
                        wait_until='commit', timeout=120000)
        if reply and not reply.ok:raise ValueError(f'Публикация вернула HTTP {reply.status}.')
        if self.panel:
            self.panel.start()
        login = page.locator('#authWindow_basic_login')
        open_tab = page.locator('.openedItem')
        await login.or_(open_tab.first).first.wait_for(timeout=140000)
        if await login.is_visible():
            user = (os.environ.get('ONEC_VISUAL_USER','') if self.base==self.initial_base and
                    not getattr(self.args,'manual_login',False) else '')
            if not user:
                return {'state': 'login_required', 'title': await page.title()}
            await self.dispatch_input(login.fill,user)
            password = os.environ.get('ONEC_VISUAL_PASSWORD')
            if password:
                await self.dispatch_input(page.locator('#authWindow_basic_password').fill,password)
            await self.dispatch_input(page.locator('#authWindow_basic_okButton').click)
        await open_tab.first.wait_for(timeout=getattr(self.args, "startup_timeout", 180000))
        await page.wait_for_function("""brigade => Boolean(
            document.getElementById('testpilot-live-overlay') &&
            (!brigade || document.getElementById('formovod-brigade-dock'))
        )""", arg=self.brigade, timeout=30000)
        state = await self.inspect('', 18)
        if self.args.preview or getattr(self.args, 'workspace', False):
            if self.preview is None:
                preview = LivePreview(workspace=getattr(self.args, 'workspace', False))
                try:
                    self.preview_url = await preview.start(page)
                except BaseException:
                    await preview.stop()
                    raise
                self.preview = preview
            state['preview_url'] = self.preview_url
            if self.preview.workspace:
                state['workspace_url'] = self.preview_url
                self.preview.reset_actions()
        return state

    async def inspect(self, query, limit, *, offset=0, kind='', bounds=False, position=None):
        state=await self.page().evaluate(SURFACE, {
            'query': query[:160], 'limit': limit, 'offset': offset,
            'kind': kind, 'bounds': bounds, 'position': position,
        })
        state['publication']=self.base
        return state

    async def validate_position(self, x, y):
        size = await self.page().evaluate('({width:innerWidth, height:innerHeight})')
        if not (0 <= x < size['width'] and 0 <= y < size['height']):
            raise ValueError(f'Coordinates must be within the current screenshot viewport {size}.')
        if self.panel_mode and await self.page().evaluate(
                "([x,y]) => document.elementFromPoint(x,y)?.id === 'formovod-brigade-dock'", [x,y]):
            raise ValueError('Эта точка находится в пульте Формовода. Выберите элемент 1С.')
        return {'x': x, 'y': y}

    async def target(self, ref):
        if not re.fullmatch(r'[a-z0-9]{4,12}-[0-9]{1,7}', ref):
            raise ValueError('Use a ref from inspect_1c.')
        selector = f'[data-testpilot-mcp="{ref}"]'
        page = self.page()
        if not await page.evaluate(SURFACE, {'query': '', 'limit': 0, 'targetRef': ref}):
            raise ValueError('The element moved or closed. Run inspect_1c again.')
        return selector, page.locator(selector)

    async def mark(self, selector, actor, note='', done=False, *, matches=None, checked_value=None,
                   typing=False, related=None):
        await self.page().evaluate(
            'detail => document.dispatchEvent(new CustomEvent("testpilot:overlay", {detail}))',
            dict(kind='mark', actor=actor, selector=selector, note=note, done=done,
                 matches=matches, checkedValue=checked_value, typing=typing, related=related),
        )

    async def require_running(self):
        if self.call_base.get() not in (None,self.base):
            raise ValueError('Активная база сменилась. Повторите осмотр новой базы.')
        if self.preview is not None and self.preview.workspace:
            self.preview.require_running()
        if self.brigade and self.tab is not None and not self.tab.is_closed():
            stopped,paused = await self.tab.evaluate("""job=>{
                const state=document.getElementById('testpilot-live-overlay')?.dataset;
                return [Boolean(job && state?.stopJob===job),state?.brigadePaused==='1'];
            }""",self.assignment.get())
            if self.panel and self.assignment.get() and self.panel.state['activeJob']==self.assignment.get():
                if stopped:self.panel.request_stop(self.assignment.get())
                if self.panel.state['stopping']:raise asyncio.CancelledError
            if paused:
                raise ValueError('Workspace is paused. Resume it in the control panel before editing.')

    async def dispatch_input(self,method,*args,**kwargs):
        if not self.panel_mode or not self.assignment.get():
            return await method(*args,**kwargs)
        await self.require_running()
        # The driver owns an already dispatched input. Keep the job busy until that
        # single operation settles, so it cannot leak into the operator's next job.
        pending=asyncio.create_task(method(*args,**kwargs))
        try:return await asyncio.shield(pending)
        except asyncio.CancelledError:
            await asyncio.gather(pending,return_exceptions=True)
            raise

    @asynccontextmanager
    async def crew_assignment(self, job=None):
        """Keep participating roles in the workspace for the lifetime of one operator job."""
        if self.assignment.get() is not None:
            yield
            return
        job = job or uuid4().hex
        token = self.assignment.set(job)
        try:
            yield
        finally:
            self.assignment.reset(token)
            if self.brigade and self.tab is not None and not self.tab.is_closed():
                await self.brigade_event('testpilot:assignment-ended', {'id':job})

    @asynccontextmanager
    async def activity(self, actor, action, ref=None, node=None, note='', *, position=None):
        result = {'state': 'done'}
        preview = self.preview
        show_preview = preview is not None and preview.workspace
        if not show_preview and not self.brigade:
            yield result
            return
        label = f'Точка ({position["x"]}, {position["y"]})' if position is not None else ''
        if node is not None:
            label = await node.evaluate_all(r"""nodes => {
                if (nodes.length !== 1) return null;
                const element = nodes[0];
                const field = element.closest('.field[id]');
                const fieldLabel = field && document.getElementById(field.id + '#title_text');
                const row = element.closest('.gridLine[rowindex]');
                const column = element.closest('[colindex]')?.getAttribute('colindex');
                const grid = row?.closest('.gridContent');
                const heading = Array.from(grid?.querySelectorAll('.gridHead [colindex]') || [])
                    .find(item => item.getAttribute('colindex') === column)?.innerText;
                const tab = element.querySelector('.tabsItemTitle[data-content]');
                const label = heading || fieldLabel?.innerText || tab?.dataset.content || element.getAttribute('aria-label')
                    || element.title || (element.matches('input, textarea') ?
                        element.id.replace(/^form\d+_/, '').replace(/_i\d+$/, '') : element.innerText) || '';
                return ((row ? 'Строка ' + (Number(row.getAttribute('rowindex')) + 1) + ' · ' : '')
                    + label.trim()).slice(0, 110);
            }""")
            if label is None:
                raise ValueError('The element moved or closed. Run inspect_1c again.')
        self.activity_seq += 1
        payload = {'actor': actor, 'action': action, 'ref': ref, 'id': self.activity_seq,
                   'label': label, 'note': note[:80], 'state': 'running', 'assignment': self.assignment.get()}
        if position is not None:
            payload['position'] = position
        call = preview.start_action(actor, action, {'ref': ref, 'label': label}, note[:80]) if show_preview else None
        try:
            if self.live_gestures and (ref or position is not None) and action != 'point':
                await self.brigade_event('testpilot:activity', {**payload, 'action':'point', 'intent':action})
                if ref:
                    await self.mark(f'[data-testpilot-mcp="{ref}"]', actor)
                arrived = await self.page().evaluate("""(trip) => new Promise(resolve => {
                    const token = crypto.randomUUID();
                    const finish = result => { clearTimeout(timer); document.removeEventListener('testpilot:arrived',done);resolve(result); };
                    const done = e => {if(e.detail.token === token)finish(e.detail.ok)};
                    const timer = setTimeout(()=>finish(false),16000);
                    document.addEventListener('testpilot:arrived',done);
                    document.dispatchEvent(new CustomEvent('testpilot:travel',{detail:{token,...trip}}));
                })""", {'actor':actor,'ref':ref,'position':position,'action':action,'id':payload['id']})
                if not arrived:
                    raise ValueError('Цель недоступна для действия. Повторите осмотр формы.')
                if ref:
                    await self.target(ref)
                if action not in ('read','verify'):
                    await self.require_running()
            if self.brigade:
                await self.brigade_event('testpilot:activity', payload)
            yield result
        except BaseException:
            result['state'] = 'error'
            raise
        finally:
            if call is not None:
                preview.finish_action(call, result['state'])
            if self.brigade and self.tab is not None and not self.tab.is_closed():
                await self.brigade_event('testpilot:activity', {**payload, **result})

    async def brigade_event(self, name, detail):
        await self.page().evaluate(
            '([type, detail]) => document.dispatchEvent(new CustomEvent(type, {detail}))',
            [name, detail],
        )


def server_for(args, *, client=None, log_external=False):
    client = client if client is not None else WebClient(args)

    @asynccontextmanager
    async def lifespan(_):
        try:
            yield
        finally:
            await client.stop()

    class LoggedMCP(FastMCP):
        journal=None
        journal_base=None

        async def call_tool(self,name,arguments):
            if not log_external or client.assignment.get():return await super().call_tool(name,arguments)
            from panel_host import preference_file
            from panel_journal import JobJournal
            if self.journal is None or self.journal_base!=client.base:
                self.journal=JobJournal(preference_file(getattr(args,'settings',None)).parent/'logs')
                self.journal_base=client.base
                self.journal.write('received',source='mcp',publication=client.base,text='Сеанс внешнего MCP-клиента')
            journal=self.journal
            call=journal.begin_tool(name,arguments)
            token=client.call_base.set(client.base)
            try:
                result=await super().call_tool(name,arguments)
                if name=='open_1c' and self.journal is journal and self.journal_base is None and client.base:
                    self.journal_base=client.base
                    journal.write('publication_selected',publication=client.base)
                journal.tool_result(call,name,result)
                if name=='close_1c':
                    journal.write('completed',answer='Клиент закрыт.')
                    self.journal=None
                return result
            except asyncio.CancelledError:
                journal.interrupted(call)
                raise
            except Exception as exc:
                journal.interrupted(call,str(exc))
                raise
            finally:client.call_base.reset(token)

    server = LoggedMCP('Formovod', instructions=(
        'Operate the configured 1C web client. Read the active window and discover actions with inspect_1c. '
        'Prefer named refs for actions. Reinspect after changes. Use scroll_1c for more visible rows. '
        'When a control has no name, take a screenshot and use inspect_at_1c before mouse_1c. '
        'Use read_1c with '
        'the expected value from the user or source to verify each filled field on the actual form. '
        'Assign an actor to actions for a distinct cursor. point_1c moves a cursor immediately '
        'without changing focus. The price, product and gtd roles have separate cursors.'
    ), lifespan=lifespan)

    @server.tool(structured_output=True)
    async def open_1c(link: str = '') -> Payload:
        """Open the selected 1C web client. Without a configured URL the operator chooses a publication."""
        if client.base is None:
            async with client.selection_lock:
                if client.base is None:
                    if args.headless:
                        return {'state':'publication_required','message':'Для фонового подключения укажите --url публикации.'}
                    await client.panel.choose_initial()
                    if client.base is None:return {'state':'selection_closed'}
                    if not link:
                        if await client.tab.locator('#authWindow_basic_login').is_visible():
                            return {'state':'login_required','title':await client.tab.title(),'publication':client.base}
                        return await client.inspect('',18)
        async with client.lock, client.check_lock:
            return await client.open(link)

    @server.tool(structured_output=True)
    async def inspect_1c(query: str = '', limit: int = 50, offset: int = 0,
                         kind: Kind | None = None, bounds: bool = False) -> Payload:
        """Inspect the active tab, dialogs and visible elements. Filter by kind or query, paginate matches, or include screenshot bounds."""
        if offset < 0:
            raise ValueError('offset cannot be negative.')
        async with client.check_lock:
            return await client.inspect(query, max(1, min(100, limit)), offset=offset,
                                        kind=kind or '', bounds=bounds)

    @server.tool(structured_output=True)
    async def inspect_at_1c(x: int, y: int) -> Payload:
        """Identify the named element under a point in the full screenshot, in unscaled viewport pixels."""
        async with client.check_lock:
            pt = await client.validate_position(x, y)
            return await client.inspect('', 0, position=pt)

    @server.tool(structured_output=True)
    async def mouse_1c(x: int, y: int, action: MouseAction = 'click', actor: Actor = 'entry') -> Payload:
        """Use the browser mouse on a point in the latest full screenshot. Supports click, double click, right click and real hover."""
        async with client.lock:
            if action != 'hover':
                await client.require_running()
            pt = await client.validate_position(x, y)
            before = await client.inspect('', 0, position=pt)
            item = before['atPoint']
            ref = item['ref'] if item else None
            node = None
            if ref:
                selector, node = await client.target(ref)
                await client.mark(selector, actor, note='указатель' if action == 'hover' else '')
            page=client.page()
            hit=await page.evaluate_handle("""({x,y})=>{
                const el=document.elementFromPoint(x,y);
                return {el, label:el && !el.childElementCount ? el.textContent : null};
            }""",pt)
            try:
                async with client.activity(actor, 'hover' if action == 'hover' else 'click', ref, node, position=pt):
                    if action!='hover':
                        await client.require_running()
                    still_target=await hit.evaluate("""({el,label},{x,y,ref})=>el?.isConnected &&
                        el===document.elementFromPoint(x,y) && (label===null || el.textContent===label) &&
                        (!ref || document.querySelector('[data-testpilot-mcp="'+CSS.escape(ref)+'"]')?.contains(el))""",
                        {**pt,'ref':ref})
                    if not still_target:
                        raise ValueError('Цель под указателем изменилась. Повторите осмотр формы.')
                    if action=='hover':
                        await page.mouse.move(x, y)
                    else:
                        await client.dispatch_input(page.mouse.click,x,y,button='right' if action == 'right_click' else 'left',
                                               click_count=2 if action == 'double_click' else 1)
            finally:
                await hit.dispose()
            await asyncio.sleep(.28)
            return {'action': action, 'atPoint': item, **await client.inspect('', 0)}

    @server.tool(structured_output=True)
    async def scroll_1c(delta_y: int = 540, delta_x: int = 0, ref: str | None = None,
                        x: int | None = None, y: int | None = None,
                        actor: Actor = 'entry') -> Payload:
        """Send a real wheel scroll over a visible ref, a screenshot point, or the viewport center. Returns visible tables after moving."""
        if not (delta_x or delta_y):
            raise ValueError('Provide a nonzero scroll distance.')
        if (x is None) != (y is None) or (ref is not None and x is not None):
            raise ValueError('Choose a ref or a complete pair of screenshot coordinates.')
        async with client.lock:
            await client.require_running()
            page = client.page()
            node = None
            if ref:
                _, node = await client.target(ref)
                box = await node.bounding_box()
                if box is None:
                    raise ValueError('The scrolling target is no longer visible.')
                size = await page.evaluate('({width:innerWidth, height:innerHeight})')
                x = int((max(0, box['x']) + min(size['width'], box['x'] + box['width'])) / 2)
                y = int((max(0, box['y']) + min(size['height'], box['y'] + box['height'])) / 2)
            elif x is None:
                size = await page.evaluate('({width:innerWidth, height:innerHeight})')
                x, y = size['width']//2, size['height']//2
            await client.validate_position(x, y)
            async with client.activity(actor, 'scroll', ref, node):
                await client.require_running()
                await page.mouse.move(x, y)
                await client.dispatch_input(page.mouse.wheel,delta_x,delta_y)
                await asyncio.sleep(.32)
            return await client.inspect('', 12, kind='table')

    @server.tool(structured_output=True)
    async def point_1c(ref: str, actor: Actor, note: str = '', related_refs: list[str] | None = None) -> Payload:
        """Move a cursor without stealing focus. Optionally mark up to eight related elements. Pass [] to clear those marks."""
        related_refs = None if related_refs is None else list(dict.fromkeys(r for r in related_refs if r != ref))
        if related_refs is not None and len(related_refs) > 8:
            raise ValueError('Use up to eight related refs from inspect_1c.')
        async with client.check_lock:
            selector, node = await client.target(ref)
            related = None if related_refs is None else [(await client.target(r))[0] for r in related_refs]
            async with client.activity(actor, 'point', ref, node, note):
                await client.mark(selector, actor, note=note[:40], related=related)
        return {'ref': ref, 'actor': actor, 'related_refs': related_refs}

    @server.tool(structured_output=True)
    async def read_1c(ref: str, actor: Actor = 'check', expected: str | None = None) -> Payload:
        """Read a visible element. expected compares case-sensitively, allowing whitespace differences. Read committed cells while typing in other cells."""
        async with (client.check_lock if actor == 'check' else client.lock):
            _, node = await client.target(ref)
            # Read and attach the result in the same browser turn. 1C may replace
            # the rendered cells as soon as an editor in another row commits.
            async with client.activity(actor, 'read' if expected is None else 'verify', ref, node) as status:
                observation = await client.page().evaluate(SURFACE, {
                    'query': '', 'limit': 0, 'targetRef': ref,
                    'read': {'actor': actor, 'expected': expected},
                })
                if observation is None:
                    raise ValueError('The element moved or closed. Run inspect_1c again.')
                status['value'] = observation['value']
                if observation['matches'] is not None:
                    status['state'] = 'match' if observation['matches'] else 'mismatch'
                    status['expected'] = expected
            result = {'ref': ref, 'value': observation['value']}
            return (result if expected is None else
                    {**result, 'expected': expected, 'matches': observation['matches']})

    @server.tool(structured_output=True)
    async def click_1c(ref: str, twice: bool = False, actor: Actor = 'entry') -> Payload:
        """Click a visible element from inspect_1c. Double-click when opening a row or editing a cell."""
        async with client.lock:
            await client.require_running()
            selector, node = await client.target(ref)
            selecting = client.panel_mode and await node.evaluate("e => !!e.closest('[role=option],.eddList > li,.menuItem')")
            async with client.activity(actor, 'select' if selecting else 'click', ref, node):
                await client.mark(selector, actor)
                if not client.panel_mode:
                    await asyncio.sleep(.32)
                await client.require_running()
                _, node = await client.target(ref)
                await client.dispatch_input(node.click,click_count=2 if twice else 1,timeout=6500)
                await asyncio.sleep(.25)
                state = await client.inspect('', 0)
            return {'clicked': ref, 'title': state['title'], 'activeTab': state['activeTab'], 'focused': state['focused']}

    @server.tool(structured_output=True)
    async def press_1c(key: Key, ref: str | None = None, actor: Actor = 'entry') -> Payload:
        """Send a standard 1C navigation or editor key. Optionally address a visible field."""
        async with client.lock:
            await client.require_running()
            if ref is None:
                if client.panel_mode and await client.page().evaluate("document.activeElement?.id === 'formovod-brigade-dock'"):
                    raise ValueError('Фокус в пульте. Выберите ref на форме 1С.')
                focused = (await client.inspect('',0)).get('focused') if client.panel_mode else None
                active_ref = focused['ref'] if focused else None
                active_node = (await client.target(active_ref))[1] if active_ref else None
                async with client.activity(actor, 'key', active_ref, active_node, key):
                    if active_node is not None and not await active_node.evaluate('e => e === document.activeElement'):
                        raise ValueError('Фокус изменился. Повторите осмотр формы.')
                    await client.require_running()
                    await client.dispatch_input(client.page().keyboard.press,key)
            else:
                selector, node = await client.target(ref)
                async with client.activity(actor, 'key', ref, node, key):
                    await client.mark(selector, actor)
                    await asyncio.sleep(.25)
                    await client.require_running()
                    _, node = await client.target(ref)
                    await client.dispatch_input(node.press,key,timeout=6500)
            await asyncio.sleep(.24)
            state = await client.inspect('', 0)
            return {'pressed': key, 'title': state['title'], 'focused': state['focused']}

    @server.tool(structured_output=True)
    async def type_1c(text: str, ref: str, replace: bool = True, commit: bool = False,
                      actor: Actor = 'entry', delay_ms: int = 205) -> Payload:
        """Type in a real input from inspect_1c. Characters appear individually. commit presses Enter."""
        if not text or len(text) > 150 or any(ord(c) < 32 for c in text):
            raise ValueError('Provide 1–150 printable characters. Use press_1c for keys.')
        if not 40 <= delay_ms <= 205:
            raise ValueError('delay_ms must be from 40 to 205.')
        async with client.lock:
            await client.require_running()
            selector, node = await client.target(ref)
            focusable = await node.evaluate("""e => e.matches('input, textarea') &&
                ['text','textarea','search','number','tel','email','url'].includes(e.type) &&
                !e.disabled && !e.readOnly""")
            if not focusable:
                raise ValueError('Open the editor and inspect it before typing.')
            async with client.activity(actor, 'type', ref, node):
                await client.require_running()
                await client.mark(selector, actor, 'набор', typing=True)
                await client.dispatch_input(node.focus,timeout=6500)
                if replace:
                    await client.dispatch_input(node.press,'Control+a',timeout=6500)
                overlay = client.page().locator('#testpilot-live-overlay')
                before = int(await overlay.get_attribute('data-glyphs') or '0')
                if client.panel_mode and client.assignment.get():
                    # A Playwright multi-character command can keep typing after its Python
                    # coroutine is cancelled. Dispatch at most one character at a time.
                    for character in text:
                        if not await node.evaluate('e => e === document.activeElement',timeout=6500):
                            raise ValueError('Редактор потерял фокус во время набора. Проверьте введённую часть.')
                        await client.dispatch_input(node.press_sequentially,character,delay=delay_ms,timeout=6500)
                else:
                    await node.press_sequentially(text, delay=delay_ms, timeout=35000)
                value = await node.input_value(timeout=6500)
                if replace and value != text and await node.evaluate("""e => e.type==='search' ||
                    e.getAttribute('role')==='searchbox' || /поиск|search/i.test(
                    [e.id,e.placeholder,e.getAttribute('aria-label'),e.title].join(' '))"""):
                    # ERP can move the caret or consume a space during incremental search.
                    # Replace the query in the same focused search editor before submitting it.
                    _, node = await client.target(ref)
                    if not await node.evaluate('e => e === document.activeElement'):
                        raise ValueError('Поле поиска потеряло фокус. Повторите осмотр формы.')
                    await client.dispatch_input(node.fill,text,timeout=6500)
                    value = await node.input_value(timeout=6500)
                    if value != text:
                        raise ValueError('Поле поиска изменило введённый текст. Проверьте строку поиска.')
                after = int(await overlay.get_attribute('data-glyphs') or '0')
                if commit:
                    # 1C may replace the editor as soon as it accepts Enter.
                    if not await node.evaluate('(e) => e === document.activeElement', timeout=6500):
                        raise ValueError('The editor lost focus before commit. Reinspect the cell.')
                    await client.dispatch_input(client.page().keyboard.press,'Enter')
            return {'ref': ref, 'editor_value': value, 'enter_sent': commit,
                    'rendered_glyphs': after - before}

    @server.tool()
    async def screenshot_1c() -> Image:
        """Show the actual tab with the live overlay."""
        async with client.check_lock:
            return Image(data=await client.page().screenshot(type='png', timeout=6500), format='png')

    @server.tool(structured_output=True)
    async def close_1c() -> Payload:
        """Close the managed browser. If recording was enabled, return the video file."""
        async with client.lock, client.check_lock:
            if client.call_base.get() not in (None,client.base):raise ValueError('Активная база сменилась.')
            return {'state': 'closed', 'recording': await client.stop()}

    if getattr(args, 'brigade_demo', False):
        @server.tool(structured_output=True)
        async def brigade_demo_1c(state: Literal['ready','busy','pending','hidden'], message: str = '') -> Payload:
            """Read the fixed demonstration request or update its panel status in a guided session."""
            if not client.brigade:
                raise ValueError('Launch with --brigade for the guided panel.')
            if state != 'pending':
                await client.brigade_event('testpilot:brigade-demo', {'state': state, 'message': message[:220]})
                return {'state': state}
            return await client.page().evaluate("""() => {
                const overlay = document.getElementById('testpilot-live-overlay');
                if (!overlay || overlay.dataset.brigadePaused === '1') {
                    return {request: null, paused: Boolean(overlay)};
                }
                const request = overlay.dataset.brigadeRequest;
                delete overlay.dataset.brigadeRequest;
                return {request: request === 'fill' || request === 'verify' ? request : null, paused: false};
            }""")

    if getattr(args, 'panel', False):
        from panel_host import PanelController
        from workbooks import register_workbooks
        register_workbooks(server, getattr(args, 'inbox', None))
        client.panel = PanelController(server,client,getattr(args,'settings',None))
    return server


async def interactive(args):
    client = WebClient(args)
    server_for(args,client=client)
    try:
        if getattr(args,'choose_base',False):
            await client.panel.choose_initial()
        else:
            try:await client.open('')
            except Exception:
                if client.tab is None or client.tab.is_closed():raise
                await client.panel.choose_initial('Не удалось открыть начальную публикацию. Проверьте адрес или выберите другую базу.')
        while any(not page.is_closed() for page in client.base_tabs.values()):
            await asyncio.sleep(.4)
    finally:
        await client.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', help='open a specific authorized 1C web publication')
    parser.add_argument('--manual-login',action='store_true',help='leave sign-in to the operator, including on the local training ERP')
    parser.add_argument('--chromium', default=os.getenv('FORMOVOD_CHROMIUM') or None,
                        help='Chromium executable override (defaults to the Playwright browser)')
    parser.add_argument('--headless', action='store_true', help='no visible window for smoke verification')
    parser.add_argument('--record-dir', help='directory for recording the actual tab')
    parser.add_argument('--preview', action='store_true', help='serve the live tab through a local spectator URL')
    parser.add_argument('--workspace', action='store_true', help='add a local role panel, activity and edit pause controls')
    parser.add_argument('--brigade', action='store_true', help='dock the animated Formovod panel alongside the live UI')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--brigade-demo', action='store_true', help='allow the local guide to serve two fixed demo requests')
    mode.add_argument('--panel', action='store_true', help='open the operator panel with a real model and animated department')
    parser.add_argument('--interactive', action='store_true', help='open the panel immediately and run until the window closes')
    parser.add_argument('--choose-base',action='store_true',help='open the publication chooser at interactive startup')
    parser.add_argument('--inbox', help='input folder for Excel workbooks (default: Desktop)')
    parser.add_argument('--settings', help='optional operator preferences JSON file')
    args = parser.parse_args()
    if args.interactive:
        if not args.panel:
            parser.error('--interactive requires --panel')
        if args.url is None:args.choose_base=True
        asyncio.run(interactive(args))
    else:
        if args.url is None and not args.panel:args.url=DEMO
        server_for(args,log_external=True).run(transport='stdio')


if __name__ == '__main__':
    main()
