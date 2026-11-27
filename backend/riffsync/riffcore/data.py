import hashlib
import json
from pathlib import Path
import numpy as np
import soundfile as sf

SOURCES=('vocals','drums','bass','guitar','piano','other')


def digest(path):
    result=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):result.update(block)
    return result.hexdigest()


def manifest(path):
    path=Path(path).resolve(); data=json.loads(path.read_text(encoding='utf-8'))
    if data.get('version')!=1 or not data.get('tracks'):raise ValueError('Manifesto RiffCore inválido ou vazio.')
    ids=set();groups={};tracks=[]
    for record in data['tracks']:
        record=dict(record)
        name=record.get('id');split=record.get('split');artist=record.get('artist_id')
        if not isinstance(name,str) or not name or name in ids:raise ValueError('Cada gravação precisa de um id único.')
        ids.add(name)
        if split not in {'train','validation','test'} or not isinstance(artist,str) or not artist:raise ValueError('Informe split e artist_id em cada gravação.')
        if record.get('label_type') not in {'teacher','ground_truth'}:raise ValueError('Identifique os rótulos como teacher ou ground_truth.')
        for group in ('artist:'+artist,'recording:'+record.get('recording_id',name)):
            if group in groups and groups[group]!=split:raise ValueError('Artista ou gravação presente em splits diferentes: '+group)
            groups[group]=split
        if set(record.get('stems',{}))!=set(SOURCES):raise ValueError('São necessárias as seis faixas, incluindo guitarra e piano.')
        gain=float(record.get('gain',1))
        if not np.isfinite(gain) or not 0<gain<=1:raise ValueError('Ganho de reconstrução inválido.')
        record['gain']=gain
        baseline_gain=float(record.get('baseline_gain',1.))
        if not np.isfinite(baseline_gain) or not 0<baseline_gain<=1:raise ValueError('Ganho do baseline inválido.')
        record['baseline_gain']=baseline_gain
        for key in ('stems','baseline'):
            if key in record:
                if set(record[key])!=set(SOURCES):raise ValueError('Baseline e referências devem ter seis faixas.')
                record[key]={kind:str((path.parent/value).resolve()) for kind,value in record[key].items()}
        record['mix']=str((path.parent/record['mix']).resolve())
        original=sf.info(record['mix'])
        if original.samplerate!=44100 or original.channels!=2 or original.frames<=0:raise ValueError('Use áudio estéreo a 44.100 Hz, em WAV ou FLAC.')
        for key in ('stems','baseline'):
            for file in record.get(key,{}).values():
                info=sf.info(file)
                if (info.samplerate,info.channels,info.frames)!=(44100,2,original.frames):raise ValueError('As seis faixas precisam estar alinhadas à mistura: '+name)
        record['frames']=original.frames
        record['genres']=record.get('genres',[])
        if not isinstance(record['genres'],list) or not all(isinstance(g,str) for g in record['genres']):raise ValueError('genres deve ser uma lista de textos.')
        tracks.append(record)
    return tracks,digest(path)


def crop(record,frames,random):
    offset=random.randint(0,max(0,record['frames']-frames))
    def read(file):
        with sf.SoundFile(file) as stream:
            stream.seek(offset); audio=stream.read(frames,dtype='float32',always_2d=True)
        audio=audio.T.copy()
        if audio.shape[-1]<frames:audio=np.pad(audio,((0,0),(0,frames-audio.shape[-1])))
        if not np.isfinite(audio).all():raise ValueError('O conjunto contém amostras inválidas.')
        return audio
    mix=read(record['mix'])
    targets=np.stack([read(record['stems'][kind])/record['gain'] for kind in SOURCES])
    # Keep stereo, timing and mixture/targets aligned through augmentation.
    gain=random.uniform(.7,1.2)
    if random.random()<.5:mix=mix[::-1].copy();targets=targets[:,::-1].copy()
    return mix*gain,targets*gain
