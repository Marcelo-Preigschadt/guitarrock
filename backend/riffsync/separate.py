"""Original-mix inference, source specialists and shared-gain PCM24 delivery.

No denoiser or gate is applied: these can destroy cymbals, pick attacks and sustain.
Models run sequentially in this child process, outside the API/worker supervisor.
"""
import argparse
import base64
import hashlib
import time
import gc
import json
import random
from contextlib import ExitStack
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from demucs.apply import BagOfModels, apply_model
from demucs.pretrained import get_model


# Official htdemucs_ft.yaml weights select these members for these sources.
SPECIALISTS = {'drums': 'f7e0c4bc', 'bass': 'd12395a8'}


def model_plan(model, quality):
    if quality == 'studio':
        plan = [('htdemucs_6s', ['guitar', 'piano', 'drums'])] if model == 'htdemucs_6s' else []
        return plan + [('melband-kimberley-vocals', ['vocals'])] + [(SPECIALISTS[kind], [kind]) for kind in ('drums','bass')]
    return [(model, None)]


class ProgressPool:
    """Lazy serial executor retaining Demucs' original overlap/add and padding."""
    def __init__(self, report):
        self.report, self.total, self.completed = report, 0, 0

    def submit(self, function, *args, **kwargs):
        self.total += 1
        owner = self

        class Result:
            def result(self):
                value = function(*args, **kwargs)
                owner.completed += 1
                owner.report(owner.completed / owner.total)
                return value

        return Result()


def infer(audio, name, targets, device, shifts, overlap, segment, report):
    if name == 'melband-kimberley-vocals':
        from .melband import vocals
        from . import config
        return ['vocals'], vocals(audio, config.DATA/'models'/'melband', device, report)
    if name == 'riffcore-qualified':
        from . import config
        from .riffcore.model import load,predict
        model,_=load(config.RIFFCORE_CHECKPOINT,device,qualified=True,report=config.RIFFCORE_REPORT)
        return predict(model,audio,device,segment,overlap,report)
    model = get_model(name).cpu().eval()
    names = list(targets or model.sources)
    indices = [model.sources.index(kind) for kind in names]
    members = list(zip(model.models, model.weights)) if isinstance(model, BagOfModels) else [(model, [1.] * len(model.sources))]
    members = [(member, [weights[i] for i in indices]) for member, weights in members if any(weights[i] for i in indices)]
    reference = audio.mean(0)
    mean, scale = reference.mean(), reference.std().clamp_min(1e-8)
    normalized = ((audio - mean) / scale)[None]
    prediction = torch.zeros(len(names), *audio.shape)
    weights = torch.zeros(len(names))
    with torch.inference_mode():
        for member_index, (member, gains) in enumerate(members):
            window = min(segment, float(member.segment))
            for shift in range(shifts):
                def on_chunk(fraction):
                    report((member_index * shifts + shift + fraction) / (len(members) * shifts))
                out = apply_model(member, normalized, device=device, shifts=1, split=True,
                                  overlap=overlap, segment=window, progress=False,
                                  num_workers=0, pool=ProgressPool(on_chunk))[0]
                for index, (source_index, gain) in enumerate(zip(indices, gains)):
                    if gain:
                        prediction[index].add_(out[source_index].cpu(), alpha=gain)
                        weights[index] += gain
                del out
            member.to('cpu')
        prediction /= weights[:, None, None]
        prediction *= scale
        prediction += mean / len(model.sources)
    del model, normalized, members
    gc.collect()
    if device == 'cuda': torch.cuda.empty_cache()
    return names, prediction


def finalize(source, raw, output, kinds):
    """One attenuation for all tracks; no independent stem normalization/clipping.

    Only Other receives the reconstruction residual. Never feed estimated stems
    back into a source separator or inject that residual into isolated targets.
    """
    raw, output = Path(raw), Path(output)
    peak, error, frames, channels, sr = 0., 0., 0, 0, 0
    with ExitStack() as stack:
        original = stack.enter_context(sf.SoundFile(source))
        sr, channels, frames = original.samplerate, original.channels, len(original)
        inputs = {kind: stack.enter_context(sf.SoundFile(raw/f'{kind}.wav')) for kind in kinds if kind != 'other'}
        for audio in inputs.values():
            if (audio.samplerate, audio.channels, len(audio)) != (sr, channels, frames):
                raise ValueError('Uma das faixas tem duração ou formato diferente da gravação.')
        residual = stack.enter_context(sf.SoundFile(raw/'other.wav', 'w', samplerate=sr, channels=channels, subtype='FLOAT'))
        for mix in original.blocks(blocksize=65536, dtype='float32', always_2d=True):
            values = [audio.read(len(mix), dtype='float32', always_2d=True) for audio in inputs.values()]
            other = mix - sum(values, np.zeros_like(mix))
            values.append(other)
            if not all(np.isfinite(value).all() for value in values):
                raise ValueError('O modelo gerou amostras inválidas; o resultado anterior foi preservado.')
            peak = max(peak, float(np.max(np.abs(mix))), *(float(np.max(np.abs(value))) for value in values))
            residual.write(other)
    gain = min(1., .98 / max(peak, 1e-8))
    output.mkdir(parents=True, exist_ok=True)
    for kind in kinds:
        with sf.SoundFile(raw/f'{kind}.wav') as audio, sf.SoundFile(output/f'{kind}.wav', 'w', samplerate=sr, channels=channels, subtype='PCM_24') as destination:
            for block in audio.blocks(blocksize=65536, dtype='float32', always_2d=True):
                destination.write(block * gain)
    # Measure delivered PCM24 reconstruction, including quantization.
    with ExitStack() as stack:
        original = stack.enter_context(sf.SoundFile(source))
        stems = [stack.enter_context(sf.SoundFile(output/f'{kind}.wav')) for kind in kinds]
        for mix in original.blocks(blocksize=65536, dtype='float32', always_2d=True):
            rebuilt = sum((audio.read(len(mix), dtype='float32', always_2d=True) for audio in stems), np.zeros_like(mix))
            error = max(error, float(np.max(np.abs(rebuilt - mix * gain))))
    return {'gain': gain, 'peak_before_gain': peak, 'reconstruction_peak_error': error,
            'encoding': 'PCM_24', 'sample_rate': sr, 'frames': frames, 'mixture_consistent': True}


def file_digest(file):
    digest = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''): digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value):
    temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value),encoding='utf-8')
    temporary.replace(path)


def cached_stage(path, signature, raw):
    try:
        state=json.loads(path.read_text(encoding='utf-8'))
        if state['signature']!=signature: return None
        for item in state['files']:
            name=item['file']
            if Path(name).name!=name or file_digest(raw/name)!=item['sha256']: return None
        random_state=(state['random'][0],tuple(state['random'][1]),state['random'][2])
        probe=random.Random(); probe.setstate(random_state)
        torch_state=bytearray(base64.b64decode(state['torch_random']))
        if len(torch_state)!=len(torch.get_rng_state()): return None
        torch.set_rng_state(torch.frombuffer(torch_state,dtype=torch.uint8))
        random.setstate(random_state)
        return state['files']
    except (OSError,ValueError,KeyError,TypeError,RuntimeError): return None


def run(source, output, model, quality, device, segment=7, overlap=.5, report=lambda *_: None, engine=None):
    from .compute import configure_torch, summary
    from . import config
    selected_engine=engine or config.ENGINE
    core=selected_engine=='riffcore' and quality=='studio' and model=='htdemucs_6s'
    if selected_engine not in {'superior','riffcore'}:raise ValueError('Motor de separação inválido.')
    started=time.monotonic()
    configure_torch()
    random.seed(2026); torch.manual_seed(2026)
    output=Path(output); output.mkdir(parents=True,exist_ok=True)
    identity={'schema':1,'input':file_digest(source),'model':model,'quality':quality,
              'device':device,'segment':segment,'overlap':overlap,'torch':torch.__version__}
    if core:
        identity.update(riffcore=file_digest(config.RIFFCORE_CHECKPOINT),qualification=file_digest(config.RIFFCORE_REPORT))
    signature=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
    kinds=['vocals','drums','bass']+(['guitar','piano'] if model=='htdemucs_6s' else [])+['other']
    try:
        saved=json.loads((output/'engine.json').read_text(encoding='utf-8'))
        if saved.get('cache_signature')==signature and set(saved.get('checksums',{}))==set(kinds):
            if all(file_digest(output/(kind+'.wav'))==saved['checksums'][kind] for kind in kinds):
                report(1.,'Recuperando separação já concluída')
                return {**saved,'reused_complete_result':True,'resume_seconds':round(time.monotonic()-started,3)}
    except (OSError,ValueError,KeyError): pass
    audio,sr=sf.read(source,dtype='float32',always_2d=True)
    if sr!=44100 or audio.shape[1]!=2 or not len(audio) or not np.isfinite(audio).all():
        raise ValueError('O áudio de entrada precisa ser estéreo, finito e a 44.100 Hz.')
    tensor=torch.from_numpy(audio.T.copy()); del audio
    raw=output/'raw'; raw.mkdir(exist_ok=True)
    plan=[('riffcore-qualified',list(k for k in kinds if k!='other'))] if core else model_plan(model,quality)
    shifts=0 if core else 2 if quality=='studio' else 1
    stages=[]
    for index,(name,targets) in enumerate(plan):
        label={'vocals':'a voz','drums':'a bateria','bass':'o baixo'}
        title='RiffCore · separando seis instrumentos' if core else 'Separando guitarra, piano e bateria' if name=='htdemucs_6s' and targets else f'Refinando {label.get(targets[0],targets[0])}' if targets else 'Separando os instrumentos'
        stage_signature=hashlib.sha256(f'{signature}:{index}:{name}:{targets}'.encode()).hexdigest()
        manifest=raw/f'stage-{index}.json'
        stage_start=time.monotonic()
        saved_files=cached_stage(manifest,stage_signature,raw)
        if saved_files:
            report((index+1)/len(plan),title+' · etapa recuperada')
            stages.append({'model':name,'seconds':round(time.monotonic()-stage_start,3),'reused':True})
            continue
        report(index/len(plan),title)
        names,values=infer(tensor,name,targets,device,shifts,overlap,segment,
                           lambda fraction:report((index+fraction)/len(plan),title))
        files=[]
        for kind,value in zip(names,values):
            if kind=='other': continue
            filename=kind+'.wav'
            if quality=='studio' and model=='htdemucs_6s' and kind=='drums':
                if name=='htdemucs_6s': filename='drums-primary.wav'
                elif name==SPECIALISTS['drums']:
                    primary,_=sf.read(raw/'drums-primary.wav',dtype='float32',always_2d=True)
                    value=(value+torch.from_numpy(primary.T.copy()))*.5
                    del primary
            sf.write(raw/filename,value.numpy().T,sr,subtype='FLOAT')
            files.append({'kind':kind,'file':filename,'sha256':file_digest(raw/filename)})
        del values,value
        atomic_json(manifest,{'signature':stage_signature,'files':files,'random':random.getstate(),
                             'torch_random':base64.b64encode(torch.get_rng_state().numpy().tobytes()).decode()})
        stages.append({'model':name,'seconds':round(time.monotonic()-stage_start,3),'reused':False})
    report(1.,'Preservando níveis e finalizando os WAVs')
    metadata=finalize(source,raw,output,kinds)
    metadata.update(model=model,quality=quality,engine='riffcore-v1' if core else 'original-mix-v2',shifts=shifts,
                    overlap=overlap,segment=segment,input='original_mix',
                    vocal_window_seconds=8 if quality=='studio' and not core else None,
                    specialists={'vocals':'melband-kimberley-vocals',**SPECIALISTS} if quality=='studio' and not core else {},
                    models=[name for name,_ in plan],stages=stages,compute=summary(),
                    elapsed_seconds=round(time.monotonic()-started,3),device=device,cache_signature=signature,
                    checksums={kind:file_digest(output/(kind+'.wav')) for kind in kinds})
    if quality=='studio' and not core:
        from .melband import REVISION,SHA256
        metadata['drum_ensemble']={'htdemucs_6s':.5,'f7e0c4bc':.5} if model=='htdemucs_6s' else {'f7e0c4bc':1.}
        metadata['vocal_model']={'repository':'KimberleyJSN/melbandroformer','revision':REVISION,'sha256':SHA256,'window':8,'overlap':.5}
    atomic_json(output/'engine.json',metadata)
    import shutil
    shutil.rmtree(raw)
    return metadata



def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--model', choices=['htdemucs', 'htdemucs_6s', 'htdemucs_ft'], default='htdemucs_6s')
    parser.add_argument('--quality', choices=['balanced', 'studio'], default='studio')
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu')
    parser.add_argument('--segment', type=float, default=7)
    parser.add_argument('--overlap', type=float, default=.5)
    args = parser.parse_args()
    run(args.source, args.output, args.model, args.quality, args.device, args.segment, args.overlap,
        report=lambda fraction, stage: print('RIFFSYNC_SEPARATION ' + json.dumps({'fraction': fraction, 'stage': stage}), flush=True))


if __name__ == '__main__': main()
