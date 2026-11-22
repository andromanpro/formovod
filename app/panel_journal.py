"""Local, per-assignment journal for the operator panel."""
from datetime import datetime
import base64
import json
from time import monotonic
from uuid import uuid4


class JobJournal:
    def __init__(self, directory):
        self.start = monotonic()
        self.path = directory / (datetime.now().strftime('%Y-%m-%d_%H-%M-%S_') + uuid4().hex[:12] + '.jsonl')
        self.error = ''
        self.names = {}
        self.calls = 0
        self.pending = {}
        self.outcomes = {label:[] for label in ('Ввод завершён','Сверено','Расхождения','Пропущено','Попытки с ошибкой','Прервано')}

    def write(self, event, **details):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open('a', encoding='utf-8') as stream:
                record = dict(time=datetime.now().astimezone().isoformat(timespec='milliseconds'),
                              elapsed_ms=round((monotonic()-self.start)*1000), event=event, **details)
                stream.write(json.dumps(record, ensure_ascii=False)+'\n')
        except OSError as exc:
            self.error = f'Журнал недоступен для записи ({exc.strerror}).'

    def begin_tool(self, name, args, **identity):
        self.calls += 1
        visible = dict(args)
        label = self.names.get(args.get('ref'))
        if label:
            visible['target'] = label
        self.pending[self.calls] = (name,label or name)
        self.write('tool_start', call=self.calls, tool=name, arguments=visible, **identity)
        return self.calls

    def end_tool(self, call, name, data):
        _,target=self.pending.pop(call)
        if isinstance(data, dict):
            if name=='type_1c':
                self.outcomes['Ввод завершён'].append(target)
            if name=='read_1c' and isinstance(data.get('matches'),bool):
                self.outcomes['Сверено' if data['matches'] else 'Расхождения'].append(target)
            for item in data.get('items', ()):
                if isinstance(item,dict) and item.get('ref'):
                    label = item.get('label') or item.get('column') or item.get('name') or ''
                    if item.get('column') and isinstance(item.get('rowIndex'),int):
                        label=f"{item.get('table','')} · строка {item['rowIndex']+1} · {item['column']}"
                    self.names[item['ref']] = ' / '.join(filter(None,(item.get('group'),label)))
        self.write('tool_done',call=call,tool=name,result=data if isinstance(data,dict) else {})

    def tool_result(self,call,name,blocks):
        if isinstance(blocks,tuple):
            data=blocks[1]
        else:
            data={}
            if name=='screenshot_1c':
                picture=next((b for b in blocks if getattr(b,'mimeType',None)=='image/png'),None)
                if picture:
                    try:
                        folder=self.path.with_suffix('')
                        folder.mkdir(exist_ok=True,parents=True)
                        (folder/f'{call}.png').write_bytes(base64.b64decode(picture.data))
                        data['screenshot']=f'{call}.png'
                    except OSError as exc:self.error=f'Не удалось сохранить снимок ({exc.strerror}).'
        self.end_tool(call,name,data)

    def interrupted(self,call,error=None):
        name,target=self.pending.pop(call)
        self.outcomes['Попытки с ошибкой' if error else 'Прервано'].append(target)
        self.write('tool_error' if error else 'tool_interrupted',call=call,tool=name,target=target,
                   **({'error':error[:750]} if error else {}))

    def skip(self,item,reason):
        self.outcomes['Пропущено'].append(f'{item} — {reason}')
        self.write('item_skipped',item=item,reason=reason)

    def stop_summary(self):
        lines=['Поручение остановлено оператором.']
        for label,entries in self.outcomes.items():
            if entries:
                recent=' / '.join(entries[-5:])
                prefix='последние 5 — ' if len(entries)>5 else ''
                lines.append(f'{label} ({len(entries)}) — {prefix}{recent}.')
        if self.outcomes['Прервано']:
            lines.append('Проверьте в форме результат прерванного действия.')
        return '\n'.join(lines)
