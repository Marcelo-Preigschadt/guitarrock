"""Pinned, checksum-verified Kimberley Jensen vocal model (MIT).

Architecture: lucidrains/BS-RoFormer, package bs-roformer==0.6.0.
Weights/config: github.com/KimberleyJensen/Mel-Band-Roformer-Vocal-Model.
Inference uses the author's 8 s windows, 50% overlap and boundary fades.
"""
import fcntl
import hashlib
import re
import urllib.request
import uuid
from pathlib import Path

import torch
from torch.nn import functional as F

REVISION = 'ac9b0614ab3cd7f77219e18ba494dfd93956c348'
SHA256 = '87201f4d31afb5bc79993230fc49446918425574db48c01c405e44f365c7559e'
URL = f'https://huggingface.co/KimberleyJSN/melbandroformer/resolve/{REVISION}/MelBandRoformer.ckpt'
MODEL_NAME = 'melband-kimberley-vocals'


def digest(file):
    checksum = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''): checksum.update(block)
    return checksum.hexdigest()


def checkpoint(cache):
    cache = Path(cache); cache.mkdir(parents=True, exist_ok=True)
    target = cache/'MelBandRoformer.ckpt'
    with (cache/'download.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if target.is_file() and digest(target) == SHA256: return target
        temporary = cache/(uuid.uuid4().hex+'.part')
        try:
            print('Baixando modelo Mel-Band RoFormer (871 MiB; apenas no primeiro uso).', flush=True)
            with urllib.request.urlopen(URL, timeout=60) as response, temporary.open('wb') as output:
                size = 0
                while block := response.read(1024*1024):
                    size += len(block)
                    if size > 1024**3: raise ValueError('O modelo excedeu o tamanho esperado.')
                    output.write(block)
            if digest(temporary) != SHA256:
                raise ValueError('O download do modelo está corrompido (SHA256 divergente). Tente novamente.')
            temporary.replace(target)
        finally: temporary.unlink(missing_ok=True)
    return target


def load_model(file, device):
    from bs_roformer import MelBandRoformer
    model = MelBandRoformer(dim=384, depth=6, linear_transformer_depth=0,
        stereo=True, num_stems=1, time_transformer_depth=1, freq_transformer_depth=1,
        num_bands=60, dim_head=64, heads=8, attn_dropout=0, ff_dropout=0,
        flash_attn=True, dim_freqs_in=1025, sample_rate=44100, stft_n_fft=2048,
        stft_hop_length=441, stft_win_length=2048, stft_normalized=False, mask_estimator_depth=2)
    state = torch.load(file, map_location='cpu', weights_only=True)
    # v0.6 adds a None slot for the disabled linear transformer. Only names move:
    # old time/frequency slots 0/1 map to 1/2; tensor values/architecture stay intact.
    state = {re.sub(r'^layers\.(\d+)\.([01])\.', lambda m: f'layers.{m[1]}.{int(m[2])+1}.', name): value for name, value in state.items()}
    model.load_state_dict(state, strict=True)
    del state
    return model.eval().to(device)


def overlap_infer(model, mix, device, report=lambda _: None, chunk=352800):
    """CPU accumulation limits device memory to a single stereo inference window."""
    original_length = mix.shape[-1]
    step, fade = chunk//2, chunk//10
    border = chunk-step
    padded = original_length > 2*border
    if padded: mix = F.pad(mix, (border,border), mode='reflect')
    window = torch.ones(chunk)
    window[:fade] = torch.linspace(0,1,fade)
    window[-fade:] = torch.linspace(1,0,fade)
    result = torch.zeros_like(mix)
    counter = torch.zeros(mix.shape[-1])
    offsets = range(0, mix.shape[-1], step)
    with torch.inference_mode():
        for index, offset in enumerate(offsets):
            part = mix[:,offset:offset+chunk]
            length = part.shape[-1]
            if length < chunk:
                part = F.pad(part, (0,chunk-length), mode='reflect' if length>chunk//2+1 else 'constant')
            predicted = model(part[None].to(device))[0].cpu()
            if predicted.shape != part.shape or not torch.isfinite(predicted).all():
                raise ValueError('O modelo de voz gerou amostras ou duração inválidas.')
            weights = window.clone()
            if offset == 0: weights[:fade] = 1
            if offset+chunk >= mix.shape[-1]: weights[-fade:] = 1
            result[:,offset:offset+length] += predicted[:,:length]*weights[:length]
            counter[offset:offset+length] += weights[:length]
            report((index+1)/len(offsets))
    if not bool((counter>0).all()): raise ValueError('Uma janela do modelo de voz ficou sem cobertura.')
    result /= counter
    if padded: result = result[:,border:-border]
    return result


def vocals(mix, cache, device, report):
    model = load_model(checkpoint(cache), device)
    result = overlap_infer(model, mix, device, report)
    del model
    if device == 'cuda': torch.cuda.empty_cache()
    return result[None]
