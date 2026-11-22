"""Named web publications belonging to the current operator."""
import hashlib
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import quote,unquote,urlsplit,urlunsplit
import re

ONE_C_META='meta[name="application-name"]:is([content="1С:Предприятие"],[content="1C:Enterprise" i])'


def publication(url):
    url=url.strip()
    u=urlsplit(url)
    if (u.scheme not in ('http','https') or not u.hostname or u.username is not None or u.password is not None
            or '?' in url or '#' in url or '\\' in url or any(ord(c)<32 for c in url) or any(c.isspace() for c in u.netloc)):
        raise ValueError('Введите HTTP(S)-адрес публикации без логина, пароля и параметров.')
    host=u.hostname.encode('idna').decode('ascii').lower()
    if ':' in host:host=f'[{host}]'
    port=u.port
    if port==0:raise ValueError('Укажите порт публикации от 1 до 65535.')
    if port is not None and port!={'https':443,'http':80}[u.scheme]:host+=f':{port}'
    parts=u.path.strip('/').split('/')
    if any(unquote(p) in ('.','..') or '/' in unquote(p) or '\\' in unquote(p) for p in parts):
        raise ValueError('Введите прямой адрес публикации.')
    path=quote(u.path.rstrip('/'),safe="/%:@-._~!$&'()*+,;=")
    url=urlunsplit((u.scheme,host,path+'/','',''))
    scope=re.sub(r'/[a-z]{2,3}_[A-Z]{2}$','',path)+'/'
    return url,(u.scheme,host),scope


def in_publication(url,origin,path):
    actual=urlsplit(url)
    return (actual.scheme,actual.netloc)==origin and (actual.path==path.rstrip('/') or actual.path.startswith(path))


class Publications:
    def __init__(self,folder,initial):
        self.folder=Path(folder)
        self.saved={initial:urlsplit(initial).netloc+unquote(urlsplit(initial).path).rstrip('/')} if initial else {}
        self.discovered={}
        for path in self.folder.glob('*.json'):
            try:
                data=json.loads(path.read_text('utf8'))
                self.saved[publication(data['url'])[0]]=self.label(data['name'])
            except (OSError,KeyError,TypeError,ValueError,AttributeError):continue

    @staticmethod
    def label(name):
        if not isinstance(name,str) or not 0<len(name.strip())<=80:raise ValueError('Укажите название базы длиной до 80 символов.')
        return name.strip()

    def save(self,url,name):
        url=publication(url)[0];name=self.label(name)
        self.folder.mkdir(parents=True,exist_ok=True)
        target=self.folder/(hashlib.sha256(url.encode()).hexdigest()+'.json')
        with NamedTemporaryFile('w',dir=self.folder,encoding='utf8',delete=False) as temp:
            tmp=Path(temp.name)
        try:
            tmp.write_text(json.dumps(dict(url=url,name=name),ensure_ascii=False),'utf8')
            os.replace(tmp,target)
        finally:tmp.unlink(missing_ok=True)
        self.saved[url]=name

    @property
    def names(self):
        return {**{url:r['name'] for url,r in self.discovered.items()},**self.saved}

    def options(self):
        return [{**self.discovered.get(url,{}),'url':url,'name':name} for url,name in self.names.items()]
