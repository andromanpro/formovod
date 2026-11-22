"""Provider settings in a private tab of the same managed browser."""
import asyncio
from pathlib import Path
from urllib.parse import urlsplit
import httpx

import codex_turn
import glm_turn
import openrouter_turn
from model_routes import PROVIDERS,ROLES,checked_proxy,route_label

VIEW='https://models.formovod.invalid/'


class ModelsView:
    def __init__(self,controller):
        self.panel=controller
        self.page=None

    async def open(self,browser):
        if self.page and not self.page.is_closed() and self.page.url==VIEW:
            await self.page.bring_to_front()
            return
        self.page=await browser.new_page()
        await self.page.route(VIEW+'**',self.handle)
        await self.page.goto(VIEW)
        await self.page.bring_to_front()

    async def handle(self,route):
        req=route.request
        path=urlsplit(req.url).path
        try:
            if path=='/' and req.method=='GET':
                return await route.fulfill(path=Path(__file__).with_name('models.html'),content_type='text/html; charset=utf-8',
                    headers={'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"})
            if (req.frame!=self.page.main_frame or self.page.url!=VIEW or req.headers.get('x-formovod-settings')!='1'):
                return await route.fulfill(status=403,body='')
            panel=self.panel;routes=panel.routes
            if path=='/state' and req.method=='GET':
                result={**routes.public(),'roleNames':ROLES,'providers':PROVIDERS,'codex':panel.state['models'],
                        'defaultModel':panel.state['model'],'busy':panel.state['busy'],'routeLabel':route_label(routes.proxy),
                        'profiles':glm_turn.profiles()}
            elif path=='/catalog' and req.method=='POST':
                data=req.post_data_json;provider=data['provider'];proxy=checked_proxy(data['proxy'])
                async with asyncio.timeout(65):
                    if provider=='codex':
                        with codex_turn.network.set(proxy):result=await codex_turn.list_models()
                    elif provider=='glm':result=await glm_turn.catalog(proxy,data.get('glmProfile',''))
                    elif provider=='openrouter':result=await openrouter_turn.catalog(proxy)
                    else:raise ValueError('Неизвестный поставщик.')
            elif path=='/save' and req.method=='POST':
                if panel.state['busy']:raise ValueError('Дождитесь окончания поручения или остановите его.')
                before=routes.proxy
                routes.save(req.post_data_json)
                panel.state['route']=route_label(routes.proxy)
                panel.refresh_routing()
                if before!=routes.proxy:panel.reload_catalog=True
                result={**routes.public(),'routeLabel':panel.state['route']}
            else:return await route.fulfill(status=404,body='')
            await route.fulfill(json=result,headers={'Cache-Control':'no-store'})
        except (httpx.HTTPError,TimeoutError):await route.fulfill(status=400,json={'error':'Поставщик не ответил. Проверьте подключение и прокси.'})
        except (ValueError,RuntimeError) as exc:await route.fulfill(status=400,json={'error':str(exc)[:350]})
        except Exception:await route.fulfill(status=400,json={'error':'Не удалось применить настройки. Проверьте параметры и доступ к хранилищу.'})
