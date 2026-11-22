"""Cold start, discovery, failed connection and operator-selected 1C session."""
import asyncio
from argparse import Namespace
from pathlib import Path
from tempfile import TemporaryDirectory
import socket
import sys
from unittest.mock import patch
from playwright.async_api import expect

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'app'))
from discover_publications import apache_sites,iis_sites,registered_sites
import discover_publications as discovery
from visual_mcp import WebClient,server_for


def configs(root):
    web=root/'web';web.mkdir()
    (web/'default.vrd').write_text('<point base="/shop"/>','utf8')
    (root/'sites.conf').write_text(f'<VirtualHost *:8443>\nServerName shop.test\nSSLEngine on\n'
        f'Alias "/shop" "{web}"\n<Directory "{web}">\nManagedApplicationDescriptor "{web}/default.vrd"\n'
        '</Directory>\n</VirtualHost>','utf8')
    conf=root/'httpd.conf'
    conf.write_text(f'Define ROOT "{root}"\nServerRoot "${{ROOT}}"\nListen 127.0.0.1:8443 https\n'
                    f'DocumentRoot "{web}"\nInclude sites.conf\n','utf8')
    assert list(apache_sites(conf,root))==[('https://shop.test:8443/shop/','shop','Apache')]
    xml=root/'applicationHost.config'
    xml.write_text(f'<configuration><system.applicationHost><sites><site name="test"><application path="/team">'
                   f'<virtualDirectory path="/shop" physicalPath="{web}"/></application><bindings>'
                   '<binding protocol="http" bindingInformation="*:8111:"/></bindings></site></sites>'
                   '</system.applicationHost></configuration>','utf8')
    assert list(iis_sites(xml))==[('http://127.0.0.1:8111/team/shop/','team/shop','IIS')]
    (root/'ibases.v8i').write_text('[Отдел]\nConnect=ws="https://shop.test:8443/shop/";\n'
                                    '[Файловая]\nConnect=File="C:/test";','utf-16')
    assert list(registered_sites(root,root))==[('https://shop.test:8443/shop/','Отдел','Список баз 1С')]


async def run(root):
    requests=[]
    async def page(reader,writer):
        try:
            request=await reader.readline()
            if not request:return
            await reader.readuntil(b'\r\n\r\n')
            requests.append(request.decode().split()[1])
            body='<meta charset="utf-8"><meta name="application-name" content="1C:Enterprise"><input id="amount" value="37">'.encode()
            writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n'
                         +f'Content-Length: {len(body)}\r\n\r\n'.encode()+body)
            await writer.drain()
        finally:writer.close()
    http=await asyncio.start_server(page,'127.0.0.1',0)
    with socket.socket() as dead:
        dead.bind(('127.0.0.1',0))
        offline=f'http://127.0.0.1:{dead.getsockname()[1]}/offline/'
        base=f'http://127.0.0.1:{http.sockets[0].getsockname()[1]}/shop/'
        args=Namespace(url=None,chromium=None,panel=True,brigade=True,headless=True,preview=False,workspace=False,
                       record_dir=None,settings=str(root/'settings.json'),inbox=str(root))
        client=WebClient(args);server=server_for(args,client=client)
        entries=[(base,'Магазин','Apache'),(base+'ru_RU/','Та же публикация','Список баз 1С'),(offline,'Остановлена','Apache')]
        async with http:
            try:
                with patch.object(discovery,'inventory',return_value=[]) as inventory:
                    response=await server.call_tool('open_1c',{})
                    assert response[1]['state']=='publication_required' and client.tab is None
                    start=await client.start()
                    task=asyncio.create_task(client.panel.choose_initial())
                    await expect(start.locator('#list')).to_have_attribute('data-scan','done')
                    assert client.base is None and len(client.browser.pages)==1
                    await expect(start.locator('#empty')).to_be_visible()
                    inventory.return_value=entries
                    await start.locator('#refresh').click()
                    await expect(start.locator('.item')).to_have_count(2)
                    await expect(start.locator('#connect')).to_be_disabled()
                    await start.locator('label.item').filter(has_text='Остановлена').click()
                    await start.locator('#connect').click()
                    await expect(start.locator('#notice')).to_contain_text('не принял соединение')
                    assert client.base is None and len(client.browser.pages)==1
                    await start.locator('#manual summary').click()
                    await start.locator('#name').fill('Черновик адреса')
                    await start.locator('#refresh').click()
                    await expect(start.locator('#list')).to_have_attribute('data-scan','done')
                    await expect(start.locator('#name')).to_have_value('Черновик адреса')
                    await start.locator('label.item').filter(has_text='Магазин').click()
                    await start.locator('#connect').click()
                    await asyncio.wait_for(task,20)
                    assert client.base==base and len(client.browser.pages)==1
                    assert (await client.inspect('amount',3,kind='field'))['items'][0]['value']=='37'
                    assert client.panel.bases.saved[base]=='Магазин'
                    assert all(path.startswith('/shop/') or path=='/favicon.ico' for path in requests),requests
            finally:await client.stop()


if __name__=='__main__':
    with TemporaryDirectory() as tmp:
        configs(Path(tmp))
        asyncio.run(run(Path(tmp)))
    print('Discovery sources, deduplication, cold start without a target, offline retry, refresh and explicit selection OK')
