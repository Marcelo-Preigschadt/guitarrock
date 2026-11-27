import argparse
import json
import math
import random
import time
from pathlib import Path
import torch
from .data import SOURCES,manifest,crop
from .model import FORMAT,base_model
from ..compute import configure_torch


def loss(prediction,target):
    """Waveform fidelity plus multi-resolution spectral distillation, FP32."""
    wave=(prediction-target).abs().mean()
    estimated=prediction.reshape(-1,prediction.shape[-1])
    expected=target.reshape(-1,target.shape[-1])
    spectral=wave.new_zeros(())
    for fft in (512,1024,2048):
        if estimated.shape[-1]<=fft:continue
        window=torch.hann_window(fft,device=prediction.device)
        first=torch.stft(estimated,fft,hop_length=fft//4,window=window,return_complex=True).abs()
        second=torch.stft(expected,fft,hop_length=fft//4,window=window,return_complex=True).abs()
        spectral+=(torch.log1p(first)-torch.log1p(second)).abs().mean()/3
    return wave+spectral


def train(path,destination,steps=1000,seconds=7.8,device='cpu',lr=2e-5,save_every=100,model=None):
    if steps<1 or not 1<=seconds<=7.8 or not math.isfinite(lr) or lr<=0 or save_every<1:raise ValueError('Parâmetros de treino inválidos.')
    all_records,signature=manifest(path)
    records=[record for record in all_records if record['split']=='train']
    validation=[record for record in all_records if record['split']=='validation']
    if not records:raise ValueError('O manifesto não tem gravações de treino.')
    configure_torch();torch.manual_seed(2026);rng=random.Random(2026)
    model=(model if model is not None else base_model()).to(device).train()
    optimizer=torch.optim.AdamW(model.parameters(),lr=lr,weight_decay=1e-4)
    output=Path(destination);output.parent.mkdir(parents=True,exist_ok=True)
    order=[SOURCES.index(kind) for kind in model.sources]
    metadata={'format':FORMAT,'sources':list(model.sources),'sample_rate':44100,
              'dataset_sha256':signature,'training_ids':[r['id'] for r in records],
              'training_artists':sorted({r['artist_id'] for r in records}),
              'training_recordings':sorted({r.get('recording_id',r['id']) for r in records}),
              'validation_ids':[r['id'] for r in validation],'validation_artists':sorted({r['artist_id'] for r in validation}),
              'trained_steps':0,'seconds':seconds,'seed':2026,'device':device}
    started=time.monotonic()
    for step in range(1,steps+1):
        record=rng.choice(records)
        mix,targets=crop(record,int(44100*seconds),rng)
        mix=torch.from_numpy(mix)[None].to(device);targets=torch.from_numpy(targets[order])[None].to(device)
        reference=mix.mean(1,keepdim=True)
        mean=reference.mean(-1,keepdim=True);scale=reference.std(-1,keepdim=True).clamp_min(1e-8)
        optimizer.zero_grad(set_to_none=True)
        prediction=model((mix-mean)/scale)
        target=(targets-mean[:,None]/len(SOURCES))/scale[:,None]
        if prediction.shape!=target.shape:raise ValueError('O estudante devolveu faixas ou tempos incompatíveis.')
        value=loss(prediction,target)
        if not torch.isfinite(value):raise ValueError('O treino produziu loss inválido.')
        value.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1.,error_if_nonfinite=True);optimizer.step()
        metadata.update(trained_steps=step,last_loss=float(value.detach()),training_seconds=round(time.monotonic()-started,3))
        print(json.dumps({'step':step,'steps':steps,'loss':metadata['last_loss'],'seconds':metadata['training_seconds']}),flush=True)
        if step%save_every==0 or step==steps:
            if validation:
                values=[];model.eval()
                with torch.no_grad():
                    for reference_record in validation[:4]:
                        validation_mix,validation_targets=crop(reference_record,int(44100*seconds),random.Random(2026))
                        validation_mix=torch.from_numpy(validation_mix)[None].to(device)
                        validation_targets=torch.from_numpy(validation_targets[order])[None].to(device)
                        reference=validation_mix.mean(1,keepdim=True)
                        center=reference.mean(-1,keepdim=True);level=reference.std(-1,keepdim=True).clamp_min(1e-8)
                        values.append(float(loss(model((validation_mix-center)/level),(validation_targets-center[:,None]/len(SOURCES))/level[:,None])))
                model.train();metadata['validation_loss']=sum(values)/len(values)
            temporary=output.with_suffix('.tmp')
            torch.save({'metadata':metadata,'state':{name:tensor.detach().cpu() for name,tensor in model.state_dict().items()}},temporary)
            temporary.replace(output)
    return metadata


def main():
    parser=argparse.ArgumentParser(description='Treinar candidato RiffCore; não altera o motor em produção.')
    parser.add_argument('manifest');parser.add_argument('output')
    parser.add_argument('--steps',type=int,default=1000);parser.add_argument('--seconds',type=float,default=7.8)
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--device',choices=['cpu','cuda'],default='cpu');parser.add_argument('--lr',type=float,default=2e-5)
    args=parser.parse_args()
    if args.dry_run:
        records,signature=manifest(args.manifest)
        print(json.dumps({'dataset_sha256':signature,'splits':{split:sum(r['split']==split for r in records) for split in ('train','validation','test')},'requested_steps':args.steps,'device':args.device}))
    else:train(args.manifest,args.output,args.steps,args.seconds,args.device,args.lr)

if __name__=='__main__':main()
