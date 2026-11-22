"""Operator diagnostics and portable MCP configuration. Can run before pip install."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
from publications import publication,ONE_C_META


ROOT=Path(__file__).resolve().parents[1]


async def check(args):
    try:
        from visual_mcp import WebClient,server_for
        from workbooks import desktop
        import codex_turn,glm_turn,openrouter_turn
        from model_routes import ModelRoutes
        from panel_voice import worker
        from panel_host import preference_file,voice_preferences
    except ImportError as exc:
        print(f'Компоненты Python — отсутствует {exc.name}. Запустите Install-Formovod.cmd.')
        return False
    ok=True
    client=WebClient(args)
    try:
        page=await client.start()
        print('Chromium — отдельный браузер запущен.')
        if client.base:
            reply=await page.goto(client.base,wait_until='domcontentloaded',timeout=20000)
            if not reply or not reply.ok:raise RuntimeError(f'HTTP {reply.status if reply else "?"}')
            await page.locator(ONE_C_META).wait_for(state='attached',timeout=12000)
            await page.locator('#formovod-brigade-dock').wait_for(state='attached',timeout=12000)
            client.page()
            print('Веб-клиент 1С — публикация ответила, пульт подключён.')
        else:
            server_for(args,client=client)
            chooser=asyncio.create_task(client.panel.choose_initial())
            try:
                await page.locator('#list[data-scan="done"]').wait_for(state='attached',timeout=60000)
                print('Стартовая форма Формовода — '+await page.locator('#count').inner_text())
            finally:
                if not page.is_closed():await page.close()
                await chooser
    except Exception as exc:
        ok=False
        if client.tab is None:
            print('Chromium — проверьте установку через Install-Formovod.cmd или укажите --chromium.')
        else:
            print('Веб-клиент 1С — проверьте адрес --url и доступность публикации.')
        print(str(exc).splitlines()[0][:260])
    finally:await client.stop()
    try:
        routes=ModelRoutes(preference_file(getattr(args,'settings',None)).with_suffix('.models.json'))
        if routes.error:raise ValueError(routes.error)
        used={routes.assignment(r,'') for r in routes.roles}
        for provider in sorted({p for p,_ in used}):
            if provider=='codex':
                with codex_turn.network.set(routes.proxy):models=await asyncio.wait_for(codex_turn.list_models(),45)
            elif provider=='glm':models=await glm_turn.catalog(routes.proxy,routes.glm_profile)
            else:
                if not routes.key():raise ValueError('Не задан ключ OpenRouter.')
                models=await openrouter_turn.catalog(routes.proxy)
            available={m['id'] for m in models}
            if not available or any(m and m not in available for p,m in used if p==provider):
                raise ValueError('Выбранная модель отсутствует в каталоге '+provider)
            print(f'{provider} — получен каталог моделей ({len(models)}).')
    except Exception as exc:
        ok=False
        print('Проверьте подключение, выбранную модель и прокси в настройках моделей.')
        print(str(exc).splitlines()[0][:260] if str(exc) else type(exc).__name__)
    try:
        inbox=Path(args.inbox or desktop()).resolve()
        next(inbox.iterdir(),None)
        print(f'Папка Excel — {inbox}.')
    except OSError:
        ok=False
        print('Папка Excel недоступна. Укажите существующую папку через --inbox.')
    try:
        prefs=json.loads(preference_file(getattr(args,'settings',None)).read_text(encoding='utf8'))
    except (ValueError,OSError):
        prefs={}
    speech=voice_preferences(prefs if isinstance(prefs,dict) else {})
    try:
        await asyncio.wait_for(worker('--probe','--model',speech['voiceModel']),15)
        print(f"Диктовка — локальный движок и веса Whisper {speech['voiceModel']} доступны.")
    except (OSError,RuntimeError,TimeoutError):
        print('Локальная диктовка недоступна. Установите выбранную модель в настройках распознавания.')
    return ok


def main():
    parser=argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check',action='store_true')
    mode.add_argument('--print-mcp',action='store_true')
    parser.add_argument('--url')
    parser.add_argument('--inbox')
    parser.add_argument('--manual-login',action='store_true')
    parser.add_argument('--chromium',default=os.getenv('FORMOVOD_CHROMIUM') or None)
    args=parser.parse_args()
    try:args.url=publication(args.url)[0] if args.url else None
    except ValueError as exc:parser.error(str(exc))
    if args.print_mcp:
        quote=lambda value:json.dumps(str(value),ensure_ascii=False)
        argv=['-B','-X','utf8','app/visual_mcp.py','--panel']
        if args.url:argv+=['--url',args.url]
        if args.manual_login:argv.append('--manual-login')
        if args.inbox:argv+=['--inbox',str(Path(args.inbox).resolve())]
        if args.chromium:argv+=['--chromium',str(Path(args.chromium).resolve())]
        print('[mcp_servers.formovod-erp]')
        print('command =',quote(sys.executable))
        print('cwd =',quote(ROOT))
        print('args =',json.dumps(argv,ensure_ascii=False))
        print('startup_timeout_sec = 35\ntool_timeout_sec = 240')
        return 0
    args.headless=True;args.panel=True;args.brigade=True;args.record_dir=None
    return 0 if asyncio.run(check(args)) else 1
