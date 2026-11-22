"""A short-lived stdio MCP for DSH. Its tools belong to the existing ERP session."""
import asyncio
from contextlib import asynccontextmanager
from contextvars import copy_context
import hmac
import json
import os
from pathlib import Path
import secrets
import sys

from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent,ImageContent,Tool


@asynccontextmanager
async def scoped_tools(specs,invoke):
    token=secrets.token_urlsafe(32)
    schema={t.name:t.model_dump(exclude_none=True,by_alias=True) for t in specs}
    context=copy_context()
    tasks=set()

    async def handle(reader,writer):
        task=asyncio.current_task()
        tasks.add(task)
        try:
            data=json.loads(await asyncio.wait_for(reader.readline(),10))
            if not hmac.compare_digest(data.get('token',''),token):return
            if data.get('method')=='list':value=list(schema.values())
            else:
                if data.get('method')!='call' or data['name'] not in schema:raise ValueError('Неизвестный инструмент роли.')
                value=await asyncio.create_task(invoke(data['name'],data['args']),context=context.copy())
            reply={'result':value}
        except Exception as exc:
            reply={'error':str(exc)[:600]}
        finally:
            try:
                if 'reply' in locals():
                    writer.write(json.dumps(reply,ensure_ascii=False).encode()+b'\n')
                    await writer.drain()
            finally:
                writer.close();tasks.discard(task)

    server=await asyncio.start_server(handle,'127.0.0.1',0,limit=2**21)
    try:
        yield {'name':'formovod','command':sys.executable,'args':['-B',str(Path(__file__).resolve())],
               'env':[{'name':'FORMOVOD_BRIDGE_TOKEN','value':token},
                      {'name':'FORMOVOD_BRIDGE_PORT','value':str(server.sockets[0].getsockname()[1])}]}
    finally:
        server.close();await server.wait_closed()
        for task in list(tasks):task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)


async def serve():
    async def exchange(method,**params):
        reader,writer=await asyncio.open_connection('127.0.0.1',int(os.environ['FORMOVOD_BRIDGE_PORT']),limit=32*1024**2)
        try:
            writer.write(json.dumps(dict(method=method,token=os.environ['FORMOVOD_BRIDGE_TOKEN'],**params)).encode()+b'\n')
            await writer.drain()
            reply=json.loads(await reader.readline())
            if 'error' in reply:raise ValueError(reply['error'])
            return reply['result']
        finally:writer.close();await writer.wait_closed()
    app=Server('formovod')

    @app.list_tools()
    async def tools():
        return [Tool.model_validate(t) for t in await exchange('list')]

    @app.call_tool()
    async def call(name,arguments):
        result=[]
        for block in await exchange('call',name=name,args=arguments):
            if block['type']=='inputText':result.append(TextContent(type='text',text=block['text']))
            else:
                header,payload=block['imageUrl'].split(',',1)
                result.append(ImageContent(type='image',data=payload,mimeType=header[5:].split(';')[0]))
        return result

    async with stdio_server() as (r,w):
        await app.run(r,w,app.create_initialization_options())


if __name__=='__main__':asyncio.run(serve())
