"""Explicit offline label generation; selected tracks only, using Superior."""
import argparse
import json
import re
import subprocess
from pathlib import Path
from ..separate import run
from .data import SOURCES,manifest


def prepare(source,destination,device='cpu'):
    source=Path(source).resolve();destination=Path(destination).resolve()
    records=json.loads(source.read_text(encoding='utf-8'))['tracks'];result=[]
    if not records or len({row['id'] for row in records})!=len(records):raise ValueError('Informe gravações com ids únicos.')
    destination.mkdir(parents=True,exist_ok=True)
    for record in records:
        name=record['id']
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',name):raise ValueError('id deve ter somente letras, números, _ e -.')
        if record.get('split','train') not in {'train','validation'}:raise ValueError('Rótulos do professor servem para treino/validação; teste de qualificação exige ground_truth.')
        folder=destination/name;folder.mkdir(exist_ok=True)
        mix=folder/'mix.wav'
        subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str((source.parent/record['mix']).resolve()),
                        '-ac','2','-ar','44100','-c:a','pcm_f32le',str(mix)],check=True)
        metadata=run(mix,folder/'teacher','htdemucs_6s','studio',device,7.8,.5,engine='superior')
        result.append({**record,'mix':str(mix),'split':record.get('split','train'),'label_type':'teacher',
                       'gain':metadata['gain'],'stems':{kind:str(folder/'teacher'/(kind+'.wav')) for kind in SOURCES},
                       'teacher_models':metadata['models']})
    target=destination/'manifest.json'
    temporary=target.with_suffix('.tmp');temporary.write_text(json.dumps({'version':1,'tracks':result},indent=2),encoding='utf-8')
    manifest(temporary);temporary.replace(target)
    return target


def main():
    parser=argparse.ArgumentParser(description='Gerar rótulos de treino com o Superior; processo offline custoso.')
    parser.add_argument('inputs');parser.add_argument('output');parser.add_argument('--device',choices=['cpu','cuda'],default='cpu')
    args=parser.parse_args();print(prepare(args.inputs,args.output,args.device))

if __name__=='__main__':main()
