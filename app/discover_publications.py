"""Read local web-server and 1C launcher configurations, then probe their published URLs."""
import asyncio
import glob
import ipaddress
import os
from pathlib import Path
import re
import shlex
from urllib.parse import urlsplit,urljoin
import xml.etree.ElementTree as ET

import httpx
from publications import publication


def read_text(path):
    raw=path.read_bytes()
    if raw.startswith((b'\xff\xfe',b'\xfe\xff')):return raw.decode('utf-16')
    try:return raw.decode('utf-8-sig')
    except UnicodeDecodeError:return raw.decode('cp1251',errors='replace')


def site_url(scheme,host,port,path):
    if host in ('','*','_default_','0.0.0.0'):host='127.0.0.1'
    if host in ('::','[::]'):host='[::1]'
    if ':' in host and not host.startswith('['):host=f'[{host}]'
    return publication(f'{scheme}://{host}:{port}/'+path.strip('/'))[0]


def binding(value,default_port):
    if value.isdigit():return '',int(value)
    parsed=urlsplit('//'+value)
    return parsed.hostname or '',parsed.port or default_port


def descriptor_base(file):
    try:root=ET.parse(file).getroot()
    except (OSError,ET.ParseError):return None
    if root.tag.rsplit('}',1)[-1]=='point':return root.get('base','/').strip('/')
    return None


def apache_sites(config,server_root):
    scopes=[dict(hosts=[],name='',ssl=False,aliases=[],dirs={},root=None)]
    scope=scopes[0];directory=None;listeners=[];variables=dict(os.environ)
    def path(value):
        expanded=re.sub(r'\$\{([^}]+)\}',lambda m:variables.get(m[1],m[0]),value)
        return server_root/expanded
    def parse(file,stack):
        nonlocal scope,directory,server_root
        if file in stack or len(stack)>20:return
        try:lines=read_text(file).splitlines()
        except OSError:return
        for line in lines:
            line=line.strip()
            if not line or line.startswith('#'):continue
            tag=line.startswith('<')
            try:parts=[x.strip('"\'') for x in shlex.split(line.strip('<>') if tag else line,posix=False)]
            except ValueError:continue
            if not parts:continue
            key=parts[0].lower();args=parts[1:]
            if key=='/virtualhost':scope=scopes[0];directory=None
            elif key=='/directory':directory=None
            elif not args:continue
            elif key=='virtualhost':
                scope=dict(hosts=args,name='',ssl=False,aliases=[],dirs={},root=None);scopes.append(scope)
            elif key=='directory':directory=path(args[0])
            elif key=='define' and len(args)>=2:variables[args[0]]=args[1]
            elif key=='serverroot':server_root=path(args[0])
            elif key in ('include','includeoptional'):
                for include in sorted(glob.glob(str(path(args[0])))):parse(Path(include),stack|{file})
            elif key=='listen':listeners.append((args[0],args[1].lower() if len(args)>1 else ''))
            elif key=='servername':scope['name']=args[0]
            elif key=='sslengine':scope['ssl']=args[0].lower()=='on'
            elif key=='documentroot':scope['root']=path(args[0])
            elif key=='alias' and len(args)==2:scope['aliases'].append((args[0],path(args[1])))
            elif key=='managedapplicationdescriptor' and directory:scope['dirs'][directory]=path(args[0])
    parse(config,set())
    for scope in scopes:
        aliases=list(scope['aliases'])
        if scope['root'] and descriptor_base(scope['dirs'].get(scope['root'],scope['root']/'default.vrd'))=='':
            aliases.append(('/',scope['root']))
        for alias,folder in aliases:
            if descriptor_base(scope['dirs'].get(folder,folder/'default.vrd')) is None:continue
            for address,protocol in listeners:
                try:
                    local,port=binding(address,80)
                    virtual=[binding(v,port) for v in scope['hosts']]
                    if virtual and not any(p==port for _,p in virtual):continue
                    scheme='https' if scope['ssl'] or protocol=='https' or port==443 else 'http'
                    hosts=[h for h,p in virtual if p==port] or [local]
                    for h in hosts:
                        # A named vhost must receive its own HTTP Host header.
                        if scope['name'] and virtual:
                            h=urlsplit(scope['name'] if '://' in scope['name'] else '//'+scope['name']).hostname or h
                        elif h=='*':h=local
                        yield site_url(scheme,h,port,alias),alias.strip('/') or folder.name,'Apache'
                except ValueError:continue


def iis_sites(config):
    try:root=ET.parse(config).getroot()
    except (OSError,ET.ParseError):return
    for site in root.findall('./system.applicationHost/sites/site'):
        for app in site.findall('application'):
            for directory in app.findall('virtualDirectory'):
                folder=Path(os.path.expandvars(directory.get('physicalPath','')))
                if descriptor_base(folder/'default.vrd') is None:continue
                alias='/'.join(filter(None,(app.get('path','').strip('/'),directory.get('path','').strip('/'))))
                for b in site.findall('bindings/binding'):
                    scheme=b.get('protocol')
                    if scheme not in ('http','https'):continue
                    try:
                        ip,port,host=b.get('bindingInformation','').rsplit(':',2)
                        yield site_url(scheme,host or ip,int(port),alias),alias or site.get('name','IIS'),'IIS'
                    except ValueError:continue


def registered_sites(folder,common):
    files={folder/'ibases.v8i'}
    for config in (folder/'1cestart.cfg',common/'1cestart.cfg'):
        try:content=read_text(config)
        except OSError:continue
        for entry in re.findall(r'(?im)^\s*CommonInfoBases\s*=\s*(.+)$',content):
            files.add(config.parent/os.path.expandvars(entry.strip().strip('"')))
    for file in sorted(files):
        try:lines=read_text(file).splitlines()
        except OSError:continue
        name=''
        for line in lines:
            line=line.strip()
            if line.startswith('[') and line.endswith(']'):name=line[1:-1];continue
            if line.partition('=')[0].strip().lower()!='connect':continue
            match=re.match(r'\s*ws\s*=\s*(?:"([^"]+)"|([^;]+))',line.partition('=')[2],re.I)
            if match:
                try:url=publication((match[1] or match[2]).strip())[0]
                except ValueError:continue
                yield url,name or urlsplit(url).netloc,'Список баз 1С'


def apache_configs(extra):
    configs={}
    def add(command,service_args=()):
        if not command:return
        args=[m[0] or m[1] for m in re.findall(r'"([^"]+)"|([^\s"]+)',command)]+list(service_args)
        if not args or Path(args[0]).name.lower() not in ('httpd.exe','apache.exe'):return
        root=Path(args[0]).parent.parent
        for i,arg in enumerate(args[:-1]):
            if arg=='-d':root=Path(args[i+1])
        file=next((Path(v) for k,v in zip(args,args[1:]) if k=='-f'),Path('conf/httpd.conf'))
        configs[root/file]=root
    if os.name=='nt':
        import pythoncom,winreg
        from win32com.client import GetObject
        def collect():
            wmi=GetObject('winmgmts:root/cimv2')
            for service in wmi.ExecQuery("SELECT Name,PathName FROM Win32_Service WHERE PathName LIKE '%httpd.exe%'"):
                args=[]
                try:
                    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,rf'SYSTEM\CurrentControlSet\Services\{service.Name}\Parameters') as key:
                        value,_=winreg.QueryValueEx(key,'ConfigArgs')
                        if isinstance(value,list):args=value
                except OSError:pass
                add(service.PathName,args)
            for proc in wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='httpd.exe'"):
                add(proc.CommandLine)
        pythoncom.CoInitialize()
        try:collect()
        except pythoncom.com_error:pass
        finally:pythoncom.CoUninitialize()
    try:lines=read_text(extra).splitlines()
    except OSError:lines=[]
    for line in lines:
        file=Path(os.path.expandvars(line.strip()))
        if file.is_absolute() and file.is_file():configs.setdefault(file,file.parent)
    return configs


def inventory(settings_dir):
    candidates=[]
    for file,root in apache_configs(settings_dir/'apache-configs.txt').items():
        candidates.extend(apache_sites(file,root))
    candidates.extend(iis_sites(Path(os.getenv('WINDIR','C:/Windows'))/'System32/inetsrv/config/applicationHost.config'))
    candidates.extend(registered_sites(Path(os.getenv('APPDATA',''))/'1C/1CEStart',
                                       Path(os.getenv('PROGRAMDATA',''))/'1C/1CEStart'))
    return candidates


async def availability(client,url):
    try:
        # Redirects to the 1C language path are normal. Keep the probe at the known origin.
        for _ in range(4):
            async with client.stream('GET',url) as r:
                if r.is_redirect and 'location' in r.headers:
                    target=urljoin(url,r.headers['location'])
                    if urlsplit(target).netloc!=urlsplit(url).netloc:return 'redirect'
                    url=target;continue
                if r.status_code in (401,403):return 'restricted'
                if not r.is_success:return 'http '+str(r.status_code)
                buf=bytearray()
                async for chunk in r.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf)>=65536:break
                page=bytes(buf).decode('utf8','replace')
                if any(re.search(r'''\bname\s*=\s*["']application-name["']''',m,re.I) and
                       re.search(r'''\bcontent\s*=\s*["']1[СC]\s*:\s*(Предприятие|Enterprise)["']''',m,re.I)
                       for m in re.findall(r'<meta\s+[^>]+>',page,re.I)):return 'online'
                return 'unconfirmed'
        return 'redirect'
    except (httpx.RequestError,TimeoutError):return 'offline'


async def scan(settings_dir,saved):
    rows={}
    sources=await asyncio.to_thread(inventory,settings_dir)
    for url,name,source in [*((p['url'],p['name'],'Подключения оператора') for p in saved),*sources]:
        try:url,origin,path=publication(url)
        except ValueError:continue
        row=rows.setdefault((origin,path),dict(url=url,name=name,sources=[]))
        if source not in row['sources']:row['sources'].append(source)
    limit=asyncio.Semaphore(6)
    async with httpx.AsyncClient(trust_env=False,timeout=3) as local,httpx.AsyncClient(timeout=3) as network:
        async def probe(row):
            async with limit:
                host=urlsplit(row['url']).hostname or ''
                try:loopback=ipaddress.ip_address(host).is_loopback
                except ValueError:loopback=host=='localhost'
                client=local if loopback or {'Apache','IIS'}.intersection(row['sources']) else network
                try:
                    async with asyncio.timeout(5):row['status']=await availability(client,row['url'])
                except TimeoutError:row['status']='offline'
        await asyncio.gather(*(probe(row) for row in rows.values()))
    return sorted(rows.values(),key=lambda r:(r['status']!='online',r['name'].casefold()))
