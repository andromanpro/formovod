"""Read-only log viewer in a tab of the managed browser, backed by local JSONL files."""
import asyncio
import json
from pathlib import Path
import re
from urllib.parse import parse_qs,urlsplit

VIEW='https://journal.formovod.invalid/'
PATTERN=re.compile(r'\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[0-9a-f]{12}\.jsonl')


class JournalView:
    def __init__(self,directory):
        self.directory=directory.resolve()
        self.page=None
        self.headers={}

    def recent(self):
        entries=[]
        for path in sorted(self.directory.glob('*.jsonl'),reverse=True):
            if not PATTERN.fullmatch(path.name) or path.resolve().parent!=self.directory:continue
            label=self.headers.get(path.name)
            if not label:
                try:
                    with path.open('r',encoding='utf8') as f:head=json.loads(f.readline())
                    label=' · '.join(filter(None,(head.get('time','')[:19].replace('T',' '),
                        head.get('publication',''),head.get('text','').replace('\n',' ')[:90])))
                    self.headers[path.name]=label
                except (OSError,ValueError,AttributeError):pass
            entries.append({'name':path.name,'label':label or path.name})
        return entries

    def read(self,name,offset):
        if not PATTERN.fullmatch(name):raise ValueError('Некорректное имя журнала.')
        path=(self.directory/name).resolve(strict=True)
        if path.parent!=self.directory:raise ValueError('Файл находится вне журнала.')
        records=[]
        with path.open('rb') as f:
            size=f.seek(0,2)
            if not 0<=offset<=size:raise ValueError('Неверная позиция.')
            f.seek(offset)
            for _ in range(80):
                start=f.tell()
                line=f.readline()
                if not line.endswith(b'\n'):
                    f.seek(start);break
                try:records.append(json.loads(line))
                except (ValueError,UnicodeError):records.append({'event':'unreadable_record','offset':start})
                if f.tell()-offset>=512_000:break
            return {'records':records,'offset':f.tell(),'more':f.tell()<size and bool(records)}

    async def handle(self,route):
        u=urlsplit(route.request.url)
        try:
            if u.path=='/' and route.request.method=='GET':
                await route.fulfill(path=Path(__file__).with_name('journal.html'),content_type='text/html; charset=utf-8',
                    headers={'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'"})
                return
            q=parse_qs(u.query)
            if u.path in ('/assets/graphite.png','/assets/journal-console.webp'):
                asset=Path(__file__).parent/'extension'/'brigade-assets'/u.path.rsplit('/',1)[1]
                await route.fulfill(path=asset,content_type='image/'+asset.suffix[1:])
                return
            if u.path=='/files':
                data=await asyncio.to_thread(self.recent)
            elif u.path=='/events':
                data=await asyncio.to_thread(self.read,q.get('file',[''])[0],int(q.get('offset',['0'])[0]))
            elif u.path=='/image':
                name=q.get('file',[''])[0];picture=q.get('image',[''])[0]
                if not PATTERN.fullmatch(name) or not re.fullmatch(r'[0-9]+\.png',picture):raise ValueError('Некорректный снимок.')
                folder=self.directory/Path(name).stem
                image=(folder/picture).resolve(strict=True)
                if image.parent!=folder:raise ValueError('Снимок находится вне журнала.')
                await route.fulfill(path=image,content_type='image/png')
                return
            else:raise ValueError('Неизвестная команда журнала.')
            await route.fulfill(json=data,headers={'Cache-Control':'no-store'})
        except (ValueError,OSError) as exc:
            await route.fulfill(status=400,json={'error':str(exc)})

    async def open(self,browser,current):
        if not self.page or self.page.is_closed():
            self.page=await browser.new_page()
            await self.page.route(VIEW+'**',self.handle)
        selected=Path(current).name if current else ''
        await self.page.goto(VIEW+('#'+selected if PATTERN.fullmatch(selected) else ''))
        await self.page.bring_to_front()
