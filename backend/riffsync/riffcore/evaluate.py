"""Compare a single-model candidate to Superior on held-out six-stem truth."""
import argparse
import json
import math
import time
from pathlib import Path
import numpy as np
import soundfile as sf
import torch
from .data import SOURCES,manifest,digest
from .model import load,predict
from ..compute import configure_torch,summary


def si_sdr(estimate,reference):
    estimate=estimate.astype('float64').ravel();reference=reference.astype('float64').ravel()
    estimate-=estimate.mean();reference-=reference.mean()
    energy=float(np.dot(reference,reference))
    if energy/max(1,len(reference))<1e-8:return None
    target=reference*(float(np.dot(estimate,reference))/max(energy,1e-12))
    error=estimate-target
    return float(10*np.log10(max(float(np.dot(target,target)),1e-12)/max(float(np.dot(error,error)),1e-12)))


def decide(rows):
    reasons=[]
    eligible=[row for row in rows if row['ground_truth'] and row['seconds']>=30]
    if len(eligible)<12:reasons.append('São necessárias pelo menos 12 gravações reais de teste com 30 s ou mais.')
    genres={genre for row in eligible for genre in row['genres']}
    if len(genres)<3:reasons.append('São necessários pelo menos três gêneros no conjunto de teste.')
    metrics={}
    for kind in SOURCES:
        deltas=[row['metrics'][kind]['delta'] for row in eligible if row['metrics'][kind]['delta'] is not None]
        if len(deltas)<4:reasons.append('Poucas referências ativas para '+kind)
        median=float(np.median(deltas)) if deltas else None
        p10=float(np.quantile(deltas,.1)) if deltas else None
        metrics[kind]={'active_tracks':len(deltas),'median_delta_si_sdr_db':median,'p10_delta_si_sdr_db':p10}
        if median is not None and (median<-.25 or p10 < -1.):reasons.append('Regressão de qualidade em '+kind)
        silence=[row['metrics'][kind] for row in eligible if row['metrics'][kind]['delta'] is None]
        if any(value['candidate_dbfs']>value['baseline_dbfs']+1 for value in silence):
            reasons.append('Mais vazamento em referências silenciosas de '+kind)
    rtfs=[row['rtf'] for row in eligible]
    median_rtf=float(np.median(rtfs)) if rtfs else None
    p95_rtf=float(np.quantile(rtfs,.95)) if rtfs else None
    if median_rtf is None or median_rtf>.5 or p95_rtf>1.:
        reasons.append('Meta de velocidade não atingida: RTF mediano <=0,5 e p95 <=1,0.')
    return {'approved':not reasons,'reasons':reasons,'eligible_tracks':len(eligible),
            'genres':sorted(genres),'per_stem':metrics,'median_rtf':median_rtf,'p95_rtf':p95_rtf}


def evaluate(path,checkpoint,report,device='cpu'):
    records,signature=manifest(path);records=[record for record in records if record['split']=='test']
    if not records or any('baseline' not in record for record in records):
        raise ValueError('Informe faixas do Superior em baseline para cada gravação de teste.')
    configure_torch();model,metadata=load(checkpoint,device)
    for record in records:
        if (record['id'] in metadata['training_ids'] or record['artist_id'] in metadata['training_artists']+metadata.get('validation_artists',[]) or
            record.get('recording_id',record['id']) in metadata.get('training_recordings',[])):
            raise ValueError('Conjunto de teste contaminado pelo treino: '+record['id'])
    rows=[]
    for record in records:
        audio,sr=sf.read(record['mix'],dtype='float32',always_2d=True)
        if device=='cuda':torch.cuda.synchronize()
        started=time.perf_counter()
        names,outputs=predict(model,torch.from_numpy(audio.T.copy()),device,7.8,.5)
        if device=='cuda':torch.cuda.synchronize()
        elapsed=time.perf_counter()-started
        estimates={kind:outputs[index].numpy().T for index,kind in enumerate(names)}
        # Match the production mix-consistent delivery policy.
        estimates['other']=audio-sum(value for key,value in estimates.items() if key!='other')
        metrics={}
        for kind in SOURCES:
            reference=sf.read(record['stems'][kind],dtype='float32',always_2d=True)[0]/record['gain']
            baseline=sf.read(record['baseline'][kind],dtype='float32',always_2d=True)[0]/record.get('baseline_gain',1.)
            first,second=si_sdr(estimates[kind],reference),si_sdr(baseline,reference)
            def dbfs(value):return float(20*math.log10(max(1e-8,float(np.sqrt(np.mean(value.astype('float64')**2))))))
            metrics[kind]={'candidate_si_sdr_db':first,'baseline_si_sdr_db':second,
                           'delta':None if first is None or second is None else first-second,
                           'candidate_dbfs':dbfs(estimates[kind]),'baseline_dbfs':dbfs(baseline)}
        row={'id':record['id'],'genres':record['genres'],'ground_truth':record['label_type']=='ground_truth',
             'seconds':len(audio)/sr,'inference_seconds':elapsed,'rtf':elapsed/(len(audio)/sr),'metrics':metrics}
        rows.append(row);print(json.dumps({'id':row['id'],'rtf':row['rtf']}),flush=True)
    result={**decide(rows),'format':'riffcore-qualification-1','checkpoint_sha256':digest(checkpoint),
            'dataset_sha256':signature,'device':device,'compute':summary(),'tracks':rows,
            'timing_scope':'warm model inference including CPU/GPU transfers, excluding file decoding and export'}
    destination=Path(report);destination.parent.mkdir(parents=True,exist_ok=True)
    temporary=destination.with_suffix('.tmp');temporary.write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8');temporary.replace(destination)
    return result


def main():
    parser=argparse.ArgumentParser(description='Qualificar RiffCore; não ativa candidatos automaticamente.')
    parser.add_argument('manifest');parser.add_argument('checkpoint');parser.add_argument('report')
    parser.add_argument('--device',choices=['cpu','cuda'],default='cpu')
    args=parser.parse_args();result=evaluate(args.manifest,args.checkpoint,args.report,args.device)
    print(json.dumps({'approved':result['approved'],'reasons':result['reasons']}))
    raise SystemExit(0 if result['approved'] else 2)

if __name__=='__main__':main()
