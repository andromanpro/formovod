"""OpenRouter's native tool protocol, restricted to the tools of the assigned role."""
import asyncio
import json
import httpx
from jsonschema import validate,ValidationError

from model_routes import http_proxy

BASE='https://openrouter.ai/api/v1'


def client(proxy):
    return httpx.AsyncClient(base_url=BASE+'/',proxy=http_proxy(proxy,'openrouter.ai'),trust_env=False,
                             timeout=httpx.Timeout(180,connect=15),follow_redirects=False)


def payload(reply):
    if not reply.is_success:
        raise RuntimeError(f'OpenRouter вернул HTTP {reply.status_code}. Проверьте ключ, модель и доступный лимит.')
    data=reply.json()
    if 'error' in data:raise RuntimeError('OpenRouter сообщил об ошибке выполнения модели.')
    return data


async def catalog(proxy):
    async with client(proxy) as api:
        rows=payload(await api.get('models'))['data']
    return sorted([dict(id=r['id'],label=r.get('name') or r['id']) for r in rows
                   if 'tools' in (r.get('supported_parameters') or [])],key=lambda m:m['label'].casefold())


async def run(prompt,specs,invoke,instructions,model,proxy,key,receipt):
    if not key:raise ValueError('Добавьте API-ключ OpenRouter в настройках моделей.')
    tools={t.name:t for t in specs}
    schemas=[{'type':'function','function':dict(name=t.name,description=t.description or '',parameters=t.inputSchema)}
             for t in specs]
    messages=[{'role':'system','content':instructions},{'role':'user','content':prompt}]
    seen=set()
    async with client(proxy) as api:
        for _ in range(96):
            data=payload(await api.post('chat/completions',headers={'Authorization':'Bearer '+key},
                json=dict(model=model,messages=messages,tools=schemas,provider={'require_parameters':True})))
            choice=data['choices'][0]
            receipt(data.get('id'),data.get('model'),data.get('usage'),choice.get('finish_reason'))
            msg=choice['message'];calls=msg.get('tool_calls') or []
            if choice.get('finish_reason') not in ('stop','tool_calls'):
                raise RuntimeError('OpenRouter прервал ответ: '+str(choice.get('finish_reason')))
            if not calls:
                if isinstance(msg.get('content'),str) and msg['content'].strip():return msg['content'].strip()
                raise RuntimeError('Модель OpenRouter вернула пустой ответ.')
            ids=[c.get('id') for c in calls]
            if not all(isinstance(i,str) and i for i in ids) or len(set(ids))!=len(ids) or seen.intersection(ids):
                raise RuntimeError('OpenRouter вернул неоднозначные идентификаторы действий.')
            seen.update(ids)
            messages.append({k:v for k,v in msg.items() if k in ('role','content','tool_calls','reasoning_details','reasoning')})

            async def execute(call):
                try:
                    name=call['function']['name']
                    if name not in tools:raise ValueError('Инструмент недоступен этой роли.')
                    args=json.loads(call['function']['arguments'])
                    validate(args,tools[name].inputSchema)
                    return await invoke(name,args)
                except ValidationError:return [{'type':'inputText','text':'Аргументы не соответствуют схеме инструмента.'}]
                except Exception as exc:return [{'type':'inputText','text':'Ошибка инструмента: '+str(exc)[:700]}]
            async with asyncio.TaskGroup() as group:
                tasks=[group.create_task(execute(call)) for call in calls]
            images=[]
            for call,task in zip(calls,tasks):
                blocks=task.result()
                text=[b['text'] for b in blocks if b['type']=='inputText']
                for b in blocks:
                    if b['type']=='inputImage':
                        images.extend([{'type':'text','text':'Снимок для '+call['id']},
                                       {'type':'image_url','image_url':{'url':b['imageUrl']}}])
                messages.append({'role':'tool','tool_call_id':call['id'],'content':'\n'.join(text) or 'Снимок приложен.'})
            if images:messages.append({'role':'user','content':images})
    raise RuntimeError('Достигнут предел вызовов инструментов за ход OpenRouter.')
