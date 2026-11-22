"""Run the optional local ASR in its own Python environment without blocking the panel."""
import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import shutil
from urllib.request import getproxies
from voice_worker import MODELS, LANGUAGES

WORKER = Path(__file__).with_name('voice_worker.py')


def voice_home():
    return Path(os.getenv('LOCALAPPDATA') or Path.home()/'.local/share')/'Formovod'


def interpreter():
    configured = os.getenv('FORMOVOD_VOICE_PYTHON')
    if configured:
        return configured
    local = voice_home()/'voice'
    python = local / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    return str(python) if python.is_file() else sys.executable


async def worker(*args, audio=b''):
    process = await asyncio.create_subprocess_exec(interpreter(), '-B', str(WORKER), *args,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    try:
        output, _ = await asyncio.wait_for(process.communicate(audio), 65)
        if process.returncode:
            raise RuntimeError('Локальный распознаватель речи недоступен.')
        return output
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


async def transcribe(clip, model='small', language='ru'):
    if not isinstance(clip,str) or not 0 < len(clip) <= 1_333_336:
        raise ValueError('Некорректная запись микрофона.')
    audio = base64.b64decode(clip,validate=True)
    if model not in MODELS or language not in LANGUAGES:raise ValueError('Неизвестные настройки распознавания.')
    return json.loads(await worker('--model',model,'--language',language,audio=audio))['text']


async def install_model(model, report):
    """Install the private local recognizer in response to the operator's button."""
    if model not in MODELS:raise ValueError('Неизвестная модель Whisper.')
    import msvcrt
    root=voice_home()
    root.mkdir(parents=True,exist_ok=True)
    env=dict(os.environ, PYTHONUTF8='1', PIP_DISABLE_PIP_VERSION_CHECK='1')
    env.setdefault('UV_PYTHON_INSTALL_DIR',str(root/'python-runtime'))
    for scheme in ('http','https'):
        proxy=getproxies().get(scheme)
        if proxy:env.setdefault(scheme.upper()+'_PROXY',proxy)

    async def execute(*argv,timeout=900):
        proc=await asyncio.create_subprocess_exec(*map(str,argv),env=env,stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            return await asyncio.wait_for(proc.wait(),timeout)==0
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()

    with (root/'voice-setup.lock').open('a+b') as lock:
        lock.seek(0)
        try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:raise RuntimeError('Установка уже выполняется в другом окне Формовода.') from None
        try:
            report('Проверяю локальный движок…')
            try:
                await worker('--probe','--model',model)
                return
            except (OSError,RuntimeError,TimeoutError):
                pass
            override=os.getenv('FORMOVOD_VOICE_PYTHON')
            python=Path(override) if override else root/'voice'/'Scripts'/'python.exe'
            if not python.is_file():
                if override:raise RuntimeError('Проверьте путь FORMOVOD_VOICE_PYTHON.')
                report('Готовлю Python для распознавания…')
                launcher=shutil.which('py')
                if launcher and await execute(launcher,'-3.12','-c','pass',timeout=20):
                    created=await execute(launcher,'-3.12','-m','venv',root/'voice')
                else:
                    # Install portable Python independently of the user's system Python.
                    setup=root/'voice-installer'
                    uv=setup/'Scripts'/'uv.exe'
                    if not uv.is_file():
                        if not (await execute(sys.executable,'-m','venv',setup) and
                            await execute(setup/'Scripts'/'python.exe','-m','pip','install','uv==0.8.22')):
                            raise RuntimeError('Не удалось скачать установщик Python с PyPI.')
                    created=await execute(uv,'venv','--python','3.12','--managed-python','--seed',root/'voice')
                if not created:raise RuntimeError('Не удалось подготовить локальный Python 3.12.')
            if not await execute(python,'-c','import faster_whisper, av',timeout=35):
                if override:raise RuntimeError('В заданном FORMOVOD_VOICE_PYTHON отсутствует faster-whisper.')
                report('Скачиваю и устанавливаю faster-whisper…')
                if not await execute(python,'-m','pip','--version',timeout=30):
                    if not await execute(python,'-m','ensurepip','--upgrade'):
                        raise RuntimeError('Не удалось подготовить pip для локального движка.')
                if not await execute(python,'-m','pip','install','faster-whisper==1.2.1','av==16.0.1'):
                    raise RuntimeError('Не удалось установить faster-whisper с PyPI. Проверьте сеть и прокси.')
            report(f'Скачиваю модель Whisper {model}…')
            if not await execute(python,'-B',WORKER,'--download','--model',model,timeout=1800):
                raise RuntimeError('Не удалось скачать модель с Hugging Face. Загрузку можно повторить.')
            report('Проверяю установленную модель…')
            await worker('--probe','--model',model)
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
