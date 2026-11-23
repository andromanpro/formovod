"""Build the operator ZIP from the runtime, its locked dependencies and the operator guide."""
import argparse
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZipFile, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]


def build(destination):
    extension=ROOT/'app'/'extension'
    version=json.loads((extension/'manifest.json').read_text('utf8'))['version']
    sources=[ROOT/name for name in ('Install-Formovod.cmd','Start-Formovod.cmd',
                                    'requirements.txt','requirements-win-py314.lock')]
    sources.extend(path for path in (ROOT/'app').glob('*.py') if path.name!='demo_brigade.py')
    sources.extend(ROOT/'app'/name for name in ('workspace.html','surface.js','journal.html','models.html','connect.html'))
    sources.extend(path for path in extension.rglob('*') if path.is_file() and path.suffix in ('.html','.js','.json','.png','.webp'))
    destination.mkdir(parents=True,exist_ok=True)
    target=destination/f'Формовод-{version}-пилот-Windows.zip'
    with NamedTemporaryFile(dir=destination,suffix='.tmp',delete=False) as tmp:
        pending=Path(tmp.name)
    try:
        with ZipFile(pending,'w',ZIP_DEFLATED) as archive:
            for path in sorted(sources):archive.write(path,path.relative_to(ROOT))
            archive.write(ROOT/'docs'/'Пилот Windows.md','README.md')
        with ZipFile(pending) as archive:
            if archive.testzip():raise ValueError('Архив повреждён.')
        pending.replace(target)
    finally:pending.unlink(missing_ok=True)
    return target

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('destination',type=Path)
    print(build(parser.parse_args().destination))
