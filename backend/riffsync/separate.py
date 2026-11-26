"""Original-mix inference, source specialists and shared-gain PCM24 delivery.

No denoiser or gate is applied: these can destroy cymbals, pick attacks and sustain.
Models run sequentially in this child process, outside the API/worker supervisor.
"""
import argparse
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


def run(source, output, model, quality, device, segment=7, overlap=.5, report=lambda *_: None):
    random.seed(2026)
    torch.manual_seed(2026)
    audio, sr = sf.read(source, dtype='float32', always_2d=True)
    if sr != 44100 or audio.shape[1] != 2 or not len(audio) or not np.isfinite(audio).all():
        raise ValueError('O áudio de entrada precisa ser estéreo, finito e a 44.100 Hz.')
    tensor = torch.from_numpy(audio.T.copy())
    del audio
    output = Path(output)
    raw = output/'raw'; raw.mkdir(parents=True, exist_ok=True)
    plan = model_plan(model, quality)
    shifts = 2 if quality == 'studio' else 1
    kinds = []
    for index, (name, targets) in enumerate(plan):
        label = {'vocals':'a voz', 'drums':'a bateria', 'bass':'o baixo'}
        title = 'Separando guitarra, piano e bateria' if name == 'htdemucs_6s' and targets else f'Refinando {label.get(targets[0], targets[0])}' if targets else 'Separando os instrumentos'
        report(index / len(plan), title)
        names, values = infer(tensor, name, targets, device, shifts, overlap, segment,
                              lambda fraction: report((index + fraction) / len(plan), title))
        for kind, value in zip(names, values):
            if kind == 'other': continue
            if quality == 'studio' and model == 'htdemucs_6s' and name == SPECIALISTS['drums'] and kind == 'drums':
                # Equal-weight ensemble: both estimates come from the original mix.
                # Retain the complementary general model instead of replacing it outright.
                primary, _ = sf.read(raw/'drums.wav', dtype='float32', always_2d=True)
                value = (value + torch.from_numpy(primary.T.copy())) * .5
                del primary
            sf.write(raw/f'{kind}.wav', value.numpy().T, sr, subtype='FLOAT')
            kinds.append(kind)
        del values, value
    kinds = [kind for kind in ('vocals', 'drums', 'bass', 'guitar', 'piano') if kind in kinds] + ['other']
    report(1., 'Preservando níveis e finalizando os WAVs')
    metadata = finalize(source, raw, output, kinds)
    metadata.update(model=model, quality=quality, engine='original-mix-v2', shifts=shifts,
                    overlap=overlap, segment=segment, input='original_mix',
                    vocal_window_seconds=8 if quality == 'studio' else None,
                    specialists={'vocals':'melband-kimberley-vocals', 'drums':SPECIALISTS['drums'], 'bass':SPECIALISTS['bass']} if quality == 'studio' else {}, models=[name for name, _ in plan])
    if quality == 'studio':
        from .melband import REVISION, SHA256
        metadata['drum_ensemble'] = {'htdemucs_6s': .5, 'f7e0c4bc': .5} if model=='htdemucs_6s' else {'f7e0c4bc':1.}
        metadata['vocal_model'] = {'repository':'KimberleyJSN/melbandroformer','revision':REVISION,'sha256':SHA256,'window':8,'overlap':.5}
    (output/'engine.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
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
