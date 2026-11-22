"""Offline Russian speech recognition. Input audio and output text travel over stdio."""
import io
import argparse
import json
import os
from pathlib import Path
import sys


MODELS = ('tiny','base','small')
LANGUAGES = ('ru','en','auto')


def local_weights(name='small'):
    from huggingface_hub.constants import HF_HUB_CACHE
    repo = Path(HF_HUB_CACHE) / ('models--Systran--faster-whisper-'+name)
    revision = (repo/'refs/main').read_text().strip() if (repo/'refs/main').is_file() else ''
    candidates = [repo/'snapshots'/revision, *sorted((repo/'snapshots').glob('*'))]
    for folder in candidates:
        if all((folder/file).is_file() for file in ('model.bin','config.json','tokenizer.json')):
            return folder
    raise RuntimeError(f'Локальная модель Whisper {name} не установлена.')


def main():
    parser=argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--download',action='store_true')
    mode.add_argument('--probe',action='store_true')
    parser.add_argument('--model',choices=MODELS,default='small')
    parser.add_argument('--language',choices=LANGUAGES,default='ru')
    args=parser.parse_args()
    if args.download:
        from huggingface_hub import snapshot_download
        snapshot_download('Systran/faster-whisper-'+args.model,allow_patterns=[
            'model.bin','config.json','tokenizer.json','vocabulary.*','preprocessor_config.json'])
        return
    os.environ['HF_HUB_OFFLINE'] = '1'
    from faster_whisper import WhisperModel
    weights = local_weights(args.model)
    if args.probe:
        return
    audio = sys.stdin.buffer.read(1_000_001)
    if not 0 < len(audio) <= 1_000_000:
        raise ValueError('Некорректная длительность записи.')
    model = WhisperModel(str(weights), device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
    segments, _ = model.transcribe(io.BytesIO(audio), language=None if args.language=='auto' else args.language,
                                   beam_size=3, vad_filter=True,
                                   hotwords='номенклатура, справочник, контрагент, договор, инвентаризация, поступление' if args.language=='ru' else None,
                                   condition_on_previous_text=False)
    text = ' '.join(s.text.strip() for s in segments if s.text.strip())
    sys.stdout.buffer.write(json.dumps({'text':text},ensure_ascii=False).encode('utf8'))


if __name__ == '__main__':
    main()
