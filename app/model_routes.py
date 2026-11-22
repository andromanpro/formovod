"""Local model assignments, credential storage and model-only network routing."""
import base64
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import getproxies, proxy_bypass

ROLES={'orchestrator':'Оркестратор','architect':'Архитектор','worker1':'Воркер 1',
       'worker2':'Воркер 2','checker':'Проверяющий'}
PROVIDERS={'codex':'Codex','glm':'GLM · подписка Z.ai через DSH','openrouter':'OpenRouter'}
MODE=re.compile(r'[A-Za-z0-9][A-Za-z0-9._/:~+@-]{0,190}\Z')
DEFAULT_PROXY={'mode':'system','url':''}


def checked_proxy(value):
    mode=value.get('mode')
    if mode not in ('system','direct','manual'):raise ValueError('Выберите способ подключения.')
    address=value.get('url','').strip()
    if address or mode=='manual':
        parsed=urlsplit(address)
        if (parsed.scheme not in ('http','https') or not parsed.hostname or not parsed.port or
                parsed.username is not None or parsed.path not in ('','/') or parsed.query or parsed.fragment or
                re.search(r'[\s\\]',address)):
            raise ValueError('Укажите HTTP(S)-адрес прокси с портом, без логина и пароля.')
    return dict(mode=mode,url=address.rstrip('/'))


def model_environment(proxy):
    env=os.environ.copy()
    if proxy['mode']=='system':
        for k,v in getproxies().items():
            if k in ('http','https','all') and v:env[k.upper()+'_PROXY']=v
        bypass=getproxies().get('no','')
    else:
        for k in list(env):
            if k.lower() in ('http_proxy','https_proxy','all_proxy','no_proxy','global_agent_http_proxy',
                             'global_agent_https_proxy','npm_config_proxy','npm_config_https_proxy'):env.pop(k)
        if proxy['mode']=='manual':
            for key in ('HTTP_PROXY','HTTPS_PROXY'):env[key]=proxy['url']
        bypass='*' if proxy['mode']=='direct' else ''
    env['NO_PROXY']=env['no_proxy']=','.join(filter(None,(bypass,'localhost','127.0.0.1','::1')))
    env['NODE_USE_ENV_PROXY']='1'
    return env


def http_proxy(proxy,host):
    if proxy['mode']=='manual':return proxy['url']
    if proxy['mode']=='system' and not proxy_bypass(host):
        values=getproxies()
        return values.get('https') or values.get('all')
    return None


def route_label(proxy):
    if proxy['mode']=='direct':return 'Модели · прямое соединение'
    address=http_proxy(proxy,'openrouter.ai')
    if not address:return 'Модели · системные настройки сети'
    u=urlsplit(address if '://' in address else '//'+address)
    return 'Прокси моделей · '+str(u.hostname)+(f':{u.port}' if u.port else '')


class ModelRoutes:
    def __init__(self,path):
        self.path=Path(path)
        self.error=''
        try:data=json.loads(self.path.read_text('utf8'))
        except FileNotFoundError:data={}
        except (OSError,ValueError):data=None
        try:
            self.roles=self.validate_roles(data.get('roles',{}))
            self.proxy=checked_proxy(data.get('proxy',DEFAULT_PROXY))
            self.sealed=data.get('openrouterSecret','')
            self.glm_profile=data.get('glmProfile','')
        except (AttributeError,ValueError,TypeError,KeyError):
            self.roles=self.validate_roles({});self.proxy=DEFAULT_PROXY.copy();self.sealed='';self.glm_profile=''
            self.error='Не удалось прочитать назначения. Проверьте роли и сохраните настройки моделей.'

    @staticmethod
    def validate_roles(raw):
        if not isinstance(raw,dict) or set(raw)-ROLES.keys():raise ValueError('Неизвестный состав ролей.')
        roles={}
        for role in ROLES:
            item=raw.get(role,{'provider':'codex' if role=='orchestrator' else 'inherit','model':''})
            provider=item['provider'];model=item.get('model','').strip()
            if provider not in PROVIDERS and not (provider=='inherit' and role!='orchestrator'):
                raise ValueError('Неизвестный поставщик для роли '+ROLES[role])
            if provider=='inherit':model=''
            if (model and not MODE.fullmatch(model)) or (provider in ('glm','openrouter') and not model):
                raise ValueError('Укажите модель для роли '+ROLES[role])
            if provider=='glm' and not model.startswith('glm-'):raise ValueError('Выберите подписочную модель GLM.')
            roles[role]={'provider':provider,'model':model}
        return roles

    def assignment(self,role,codex):
        item=self.roles[role]
        if item['provider']=='inherit':item=self.roles['orchestrator']
        return item['provider'],item['model'] or codex

    def public(self):
        return {'roles':self.roles,'proxy':self.proxy,'glmProfile':self.glm_profile,'keySource':'saved' if self.sealed else
                'environment' if os.getenv('OPENROUTER_API_KEY') else ''}

    def key(self):
        if not self.sealed:return os.getenv('OPENROUTER_API_KEY','').strip()
        import win32crypt
        return win32crypt.CryptUnprotectData(base64.b64decode(self.sealed),None,None,None,1)[1].decode()

    def save(self,data):
        roles=self.validate_roles(data['roles']);proxy=checked_proxy(data['proxy'])
        profile=data.get('glmProfile','')
        if profile and not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',profile):raise ValueError('Некорректное имя профиля DSH.')
        sealed=self.sealed
        key=data.get('key','').strip()
        if key:
            if not key.isascii() or not key.isprintable() or ' ' in key or len(key)>4096:
                raise ValueError('Проверьте формат ключа OpenRouter.')
            import win32crypt
            sealed=base64.b64encode(win32crypt.CryptProtectData(key.encode(),'Formovod · OpenRouter',None,None,None,1)).decode()
        elif data.get('forgetKey') is True:sealed=''
        if any(r['provider']=='openrouter' for r in roles.values()) and not (sealed or os.getenv('OPENROUTER_API_KEY')):
            raise ValueError('Для выбранной роли укажите ключ OpenRouter или задайте OPENROUTER_API_KEY.')
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile('w',dir=self.path.parent,delete=False,encoding='utf8') as f:
            tmp=Path(f.name)
        try:
            tmp.write_text(json.dumps(dict(roles=roles,proxy=proxy,glmProfile=profile,openrouterSecret=sealed),ensure_ascii=False),'utf8')
            os.replace(tmp,self.path)
        finally:tmp.unlink(missing_ok=True)
        self.roles,self.proxy,self.sealed=roles,proxy,sealed
        self.glm_profile=profile
        self.error=''
