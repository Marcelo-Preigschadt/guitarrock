import json
from pathlib import Path
import torch
from .data import SOURCES,digest

FORMAT='riffcore-student-1'


def base_model():
    from demucs.pretrained import get_model
    bag=get_model('htdemucs_6s')
    model=bag.models[0] if hasattr(bag,'models') else bag
    if set(model.sources)!=set(SOURCES) or model.samplerate!=44100:raise ValueError('Arquitetura base incompatível.')
    return model


def load(path,device='cpu',qualified=False,report=None):
    path=Path(path)
    checkpoint=torch.load(path,map_location='cpu',weights_only=True)
    meta=checkpoint.get('metadata',{})
    if meta.get('format')!=FORMAT or set(meta.get('sources',[]))!=set(SOURCES) or meta.get('trained_steps',0)<1:
        raise ValueError('O candidato RiffCore ainda não tem pesos treinados válidos.')
    if qualified:
        approval=json.loads(Path(report).read_text(encoding='utf-8'))
        if approval.get('approved') is not True or approval.get('checkpoint_sha256')!=digest(path) or approval.get('eligible_tracks',0)<12:
            raise ValueError('O candidato RiffCore não passou pela qualificação de qualidade e velocidade.')
    model=base_model();model.load_state_dict(checkpoint['state'],strict=True)
    if list(model.sources)!=meta['sources']:raise ValueError('Ordem de faixas incompatível com o checkpoint.')
    return model.eval().to(device),meta


def predict(model,audio,device,segment,overlap,report=lambda _:None):
    from demucs.apply import apply_model
    from ..separate import ProgressPool
    reference=audio.mean(0)
    mean,scale=reference.mean(),reference.std().clamp_min(1e-8)
    with torch.inference_mode():
        prediction=apply_model(model,((audio-mean)/scale)[None],device=device,shifts=0,
            split=True,segment=min(segment,float(model.segment)),overlap=overlap,
            num_workers=0,pool=ProgressPool(report))[0].cpu()
        prediction=prediction*scale+mean/len(model.sources)
    return list(model.sources),prediction
