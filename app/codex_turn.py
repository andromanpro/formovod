"""Codex stdio model adapter. The host supplies its own Formovod tools."""
import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import tomllib
from model_routes import DEFAULT_PROXY,model_environment

network=ContextVar('formovod_model_proxy',default=DEFAULT_PROXY)


def codex_binary():
    configured = os.environ.get('FORMOVOD_CODEX')
    if configured:
        return configured
    if os.name != 'nt':
        return shutil.which('codex')
    on_path = shutil.which('codex.exe')
    if on_path:
        return on_path
    # Explorer's PATH need not include the desktop app's versioned native binary.
    desktop = Path(os.environ.get('LOCALAPPDATA') or Path.home()/'AppData/Local')/'OpenAI/Codex/bin'
    npm = Path(os.environ.get('APPDATA') or Path.home()/'AppData/Roaming')/'npm/node_modules/@openai/codex/node_modules'
    for candidates in (desktop.glob('*/codex.exe'), npm.glob('**/bin/codex.exe')):
        binaries = sorted(candidates,key=lambda p:p.stat().st_mtime,reverse=True)
        if binaries:
            return str(binaries[0])
    return None


def launch_options():
    binary=codex_binary()
    if not binary:raise RuntimeError('Установите Codex CLI и войдите в аккаунт.')
    args=[binary,'app-server','--listen','stdio://','--disable','shell_tool','--disable','apps',
          '-c','web_search="disabled"']
    home=Path(os.environ.get('CODEX_HOME') or Path.home()/'.codex')
    config=home/'config.toml'
    if config.is_file():
        with config.open('rb') as fh: settings=tomllib.load(fh)
        for name in settings.get('mcp_servers',{}):
            if not re.fullmatch(r'[A-Za-z0-9_-]+',name):
                raise ValueError(f'Неподдерживаемое имя внешнего MCP в профиле Codex: {name}')
            args+=['-c',f'mcp_servers.{name}.enabled=false']
    return args,model_environment(network.get())


class Rpc:
    def __init__(self,proc):
        self.proc=proc
        self.errors=[]
        self.serial=0

    async def drain_errors(self):
        while line:=await self.proc.stderr.readline():
            self.errors.append(line.decode('utf8','replace').strip()[:300])
            del self.errors[:-4]

    async def send(self,message):
        self.proc.stdin.write(json.dumps(message,ensure_ascii=False).encode('utf8')+b'\n')
        await self.proc.stdin.drain()

    async def receive(self):
        line=await self.proc.stdout.readline()
        if not line:raise RuntimeError('Codex завершил соединение. '+' '.join(self.errors)[-360:])
        return json.loads(line)

    async def deny(self,message):
        await self.send({'id':message['id'],'error':{'code':-32601,'message':'Unsupported host capability.'}})

    async def request(self,method,params):
        self.serial+=1
        await self.send({'id':self.serial,'method':method,'params':params})
        while True:
            message=await self.receive()
            if message.get('id')==self.serial and 'method' not in message:
                if 'error' in message:raise RuntimeError(message['error']['message'])
                return message['result']
            if 'id' in message and 'method' in message:await self.deny(message)


@asynccontextmanager
async def connection():
    args,env=launch_options()
    with tempfile.TemporaryDirectory(prefix='formovod-codex-') as cwd:
        proc=await asyncio.create_subprocess_exec(*args,cwd=cwd,env=env,stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,limit=32*1024*1024,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        rpc=Rpc(proc)
        logger=asyncio.create_task(rpc.drain_errors())
        try:
            await rpc.request('initialize',{'clientInfo':{'name':'formovod','version':'1.0','title':'Формовод'},
                                            'capabilities':{'experimentalApi':True}})
            await rpc.send({'method':'initialized','params':{}})
            yield rpc,cwd
        finally:
            proc.stdin.close()
            try:await asyncio.wait_for(proc.wait(),4)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
            await logger


async def list_models():
    result=[]
    cursor=None
    async with connection() as (rpc,_):
        while True:
            page=await rpc.request('model/list',{'limit':100,'includeHidden':False,'cursor':cursor})
            for model in page['data']:
                result.append({'id':model.get('model') or model['id'],'label':model.get('displayName') or model['id'],
                               'default':bool(model.get('isDefault'))})
            cursor=page.get('nextCursor')
            if not cursor:return result


async def run_turn(prompt,specs,invoke,instructions,model=None):
    async with connection() as (rpc,cwd):
        opts=dict(cwd=cwd,ephemeral=True,approvalPolicy='never',sandbox='read-only',environments=[],
                  selectedCapabilityRoots=[],baseInstructions=instructions,dynamicTools=[
                     dict(type='function',name=s.name,description=s.description or '',inputSchema=s.inputSchema,
                          deferLoading=False) for s in specs])
        if model:opts['model']=model
        thread=(await rpc.request('thread/start',opts))['thread']['id']
        turn=(await rpc.request('turn/start',dict(threadId=thread,environments=[],
            input=[dict(type='text',text=prompt,text_elements=[])])))['turn']['id']
        pending=set()
        async def answer(message):
            params=message['params']
            try:
                if params['threadId']!=thread or params['turnId']!=turn:raise ValueError('Другая сессия.')
                content=await invoke(params['tool'],params['arguments'])
                result={'success':True,'contentItems':content}
            except Exception as exc:
                result={'success':False,'contentItems':[{'type':'inputText','text':str(exc)[:750]}]}
            await rpc.send({'id':message['id'],'result':result})
        final=''
        blocker=''
        try:
            while True:
                msg=await rpc.receive()
                method=msg.get('method')
                if method=='item/tool/call':
                    pending.add(asyncio.create_task(answer(msg)))
                    continue
                if 'id' in msg and method:
                    await rpc.deny(msg)
                    continue
                params=msg.get('params') or {}
                if params.get('threadId')!=thread:continue
                if method=='hook/completed' and params['run']['status']=='blocked':
                    blocker='Запуск остановил обработчик Codex: '+params['run']['eventName']
                if method=='item/completed' and params.get('turnId')==turn:
                    item=params['item']
                    if item.get('type')=='agentMessage' and item.get('text'):final=item['text']
                if method=='turn/completed' and params['turn'].get('id')==turn:
                    if pending:await asyncio.gather(*pending)
                    ended=params['turn']
                    if ended.get('status')!='completed':
                        raise RuntimeError((ended.get('error') or {}).get('message') or 'Поручение прервано.')
                    if not final.strip():raise RuntimeError(blocker or 'Модель завершила ход без ответа.')
                    return final.strip()
        finally:
            for task in pending:
                if not task.done():task.cancel()
            if pending:await asyncio.gather(*pending,return_exceptions=True)
