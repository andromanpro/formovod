"""Run subscribed GLM through the installed DSH ACP profile and scoped Formovod MCP."""
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import shutil
import re
import subprocess
import tempfile

from model_routes import model_environment
from role_bridge import scoped_tools

DISABLED=('tool-plugin-manager','tool-bash','tool-pwsh','tool-jobs','tool-fs','tool-fs-search',
          'tool-working-directory','tool-workflow','tool-web','tool-todo','tool-goal','tool-skill',
          'tool-subagent','tool-subagent-control','tool-subagent-fork','mcp-resources','session-title-llm')


class ACP:
    def __init__(self,proc,specs):
        self.proc=proc;self.seq=0;self.text=[];self.calls={}
        self.allowed={'mcp__formovod__'+s.name for s in specs}

    async def send(self,**params):
        self.proc.stdin.write(json.dumps({'jsonrpc':'2.0',**params},ensure_ascii=False).encode()+b'\n')
        await self.proc.stdin.drain()

    async def request(self,method,params):
        self.seq+=1
        await self.send(id=self.seq,method=method,params=params)
        while line:=await self.proc.stdout.readline():
            try:event=json.loads(line)
            except ValueError:continue
            if 'method' not in event and event.get('id')==self.seq:
                if 'error' in event:raise RuntimeError(f'DSH отклонил {method}. Проверьте профиль и вход Z.ai Coding Plan.')
                return event.get('result',{})
            name=event.get('method');data=event.get('params',{})
            if name=='session/update':
                u=data.get('update',{})
                if u.get('sessionUpdate')=='agent_message_chunk' and u.get('content',{}).get('type')=='text':
                    self.text.append(u['content']['text'])
                if u.get('sessionUpdate')=='tool_call':self.calls[u['toolCallId']]=u.get('title')
            elif name=='session/request_permission':
                known=self.calls.get(data.get('toolCall',{}).get('toolCallId')) in self.allowed
                option=next((o['optionId'] for o in data.get('options',[]) if known and o['kind']=='allow_once'),None)
                await self.send(id=event['id'],result={'outcome':{'outcome':'selected','optionId':option} if option else {'outcome':'cancelled'}})
            elif name and 'id' in event:await self.send(id=event['id'],error={'code':-32601,'message':'Unsupported'})
        raise RuntimeError('DSH закрыл соединение с Формоводом.')


def subscriptions(session):
    models={}
    def visit(options):
        for item in options:
            if 'options' in item:visit(item['options']);continue
            value=item.get('value','')
            try:provider,model=json.loads(value)
            except (ValueError,TypeError):continue
            if provider=='zai-coding-plan' and isinstance(model,str) and model.startswith('glm-'):
                models[model]=value
    option=next((o for o in session.get('configOptions',[]) if o['id']=='model'),{})
    visit(option.get('options',[]))
    if not models:raise ValueError('Профиль DSH не предлагает модели подписки Z.ai Coding Plan.')
    return models


def profiles():
    root=Path(os.environ.get('DSH_HOME') or Path.home()/'.dsh')/'profiles'
    names=[]
    for file in root.glob('*/package.json'):
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',file.parent.name):continue
        try:bundles=json.loads(file.read_text('utf-8-sig'))['dsh']['profile']['bundles']
        except (ValueError,KeyError,TypeError,OSError):continue
        if '@deepseek-ai/dsh-acp-app' in bundles:names.append(file.parent.name)
    return sorted(names)


@asynccontextmanager
async def session(proxy,specs=(),servers=(),profile=''):
    available=profiles()
    profile=profile or next((p for p in ('agent-office','legion-rooms','acp') if p in available),None)
    node=shutil.which('node')
    entry=Path(os.getenv('APPDATA',''))/'npm/node_modules/@deepseek-ai/dsh/lib/bin.js'
    if not node or profile not in available or not entry.is_file():
        raise RuntimeError('Установите DSH и выберите его ACP-профиль с подпиской zai-coding-plan.')
    with tempfile.TemporaryDirectory(prefix='formovod-glm-') as tmp:
        patch=Path(tmp)/'role.json'
        patch.write_text(json.dumps([{'id':k,'disabled':True} for k in DISABLED]+[
            {'id':'session-persistence-jsonl','config':{'root':str(Path(tmp)/'sessions')}}]),'utf8')
        env=model_environment(proxy)
        for k in ('OPENROUTER_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY'):env.pop(k,None)
        proc=await asyncio.create_subprocess_exec(node,str(entry),'--profile',profile,'--patch',str(patch),
            cwd=tmp,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
            limit=32*1024**2,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        rpc=ACP(proc,specs)
        try:
            async with asyncio.timeout(55):
                await rpc.request('initialize',dict(protocolVersion=1,clientCapabilities={},clientInfo={'name':'formovod','version':'0.7'}))
                state=await rpc.request('session/new',{'cwd':tmp,'mcpServers':list(servers)})
            yield rpc,state
        finally:
            proc.stdin.close()
            try:await asyncio.wait_for(proc.wait(),3)
            except TimeoutError:
                if proc.returncode is None:proc.kill()
                await proc.wait()


async def catalog(proxy,profile=''):
    async with session(proxy,profile=profile) as (_,state):
        return [{'id':k,'label':k} for k in subscriptions(state)]


async def run(prompt,specs,invoke,instructions,model,proxy,profile=''):
    async with scoped_tools(specs,invoke) as bridge, session(proxy,specs,[bridge],profile) as (rpc,state):
        value=subscriptions(state).get(model)
        if not value:raise ValueError('Выбранная модель отсутствует в подписочном профиле DSH.')
        sid=state['sessionId']
        changed=await rpc.request('session/set_config_option',dict(sessionId=sid,configId='model',value=value))
        if not any(o['id']=='model' and o.get('currentValue')==value for o in changed.get('configOptions',[])):
            raise ValueError('DSH не подтвердил подписочный маршрут для выбранной модели.')
        reply=await rpc.request('session/prompt',dict(sessionId=sid,prompt=[{'type':'text','text':instructions+'\n\n'+prompt}]))
        answer=''.join(rpc.text).strip()
        if reply.get('stopReason')!='end_turn' or not answer:raise RuntimeError('DSH не вернул завершённый ответ.')
        return answer
