import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

AVAILABLE=all(importlib.util.find_spec(name) for name in ('demucs','torch','numpy','soundfile'))
if AVAILABLE:
    import numpy as np
    import soundfile as sf
    import torch
    from riffsync.riffcore.data import SOURCES,manifest
    from riffsync.riffcore.model import FORMAT,load
    from riffsync.riffcore.train import train
    from riffsync.riffcore.evaluate import decide,si_sdr


@unittest.skipUnless(AVAILABLE,'AI libraries required; no external weights downloaded')
class RiffCoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        t=np.arange(44100)/44100;audio=np.column_stack((np.sin(2*np.pi*220*t),np.sin(2*np.pi*330*t)))*.2
        sf.write(self.root/'mix.wav',audio,44100,subtype='FLOAT')
        stems={}
        for index,kind in enumerate(SOURCES):
            file=self.root/(kind+'.wav');sf.write(file,audio*(index+1)/21,44100,subtype='FLOAT');stems[kind]=str(file)
        self.record={'id':'training','artist_id':'artist-a','split':'train','label_type':'teacher','mix':str(self.root/'mix.wav'),'stems':stems}
        self.file=self.root/'manifest.json';self.write([self.record])

    def tearDown(self):self.temp.cleanup()

    def write(self,records):self.file.write_text(json.dumps({'version':1,'tracks':records}))

    def test_manifest_rejects_leaked_artists_missing_sources_and_misaligned_targets(self):
        self.write([self.record,{**self.record,'id':'test','split':'test'}])
        with self.assertRaisesRegex(ValueError,'splits diferentes'):manifest(self.file)
        self.write([{**self.record,'stems':{'vocals':self.record['stems']['vocals']}}])
        with self.assertRaisesRegex(ValueError,'seis faixas'):manifest(self.file)
        self.write([self.record]);sf.write(self.record['stems']['guitar'],np.zeros((100,2)),44100)
        with self.assertRaisesRegex(ValueError,'alinhadas'):manifest(self.file)

    def test_training_updates_parameters_and_saves_a_real_safe_checkpoint(self):
        class Tiny(torch.nn.Module):
            sources=list(SOURCES)
            def __init__(self):super().__init__();self.weight=torch.nn.Parameter(torch.zeros(6))
            def forward(self,audio):return audio[:,None]*self.weight[None,:,None,None]
        model=Tiny();output=self.root/'candidate.pt'
        metadata=train(self.file,output,steps=3,seconds=1,lr=.03,model=model)
        self.assertEqual(metadata['trained_steps'],3);self.assertTrue(torch.isfinite(model.weight).all())
        self.assertGreater(model.weight.abs().sum().item(),0)
        saved=torch.load(output,weights_only=True)
        self.assertEqual(saved['metadata']['format'],FORMAT)
        self.assertEqual(saved['metadata']['training_ids'],['training'])
        torch.testing.assert_close(saved['state']['weight'],model.weight)
        report=self.root/'report.json';report.write_text(json.dumps({'approved':False}))
        with patch('riffsync.riffcore.model.base_model') as base:
            with self.assertRaisesRegex(ValueError,'qualificação'):load(output,qualified=True,report=report)
            base.assert_not_called()

    def test_untrained_checkpoint_cannot_activate_even_with_an_approval_file(self):
        output=self.root/'untrained.pt'
        torch.save({'metadata':{'format':FORMAT,'sources':list(SOURCES),'trained_steps':0},'state':{}},output)
        with self.assertRaisesRegex(ValueError,'pesos treinados'):load(output,qualified=True,report=self.root/'anything.json')

    def test_qualification_requires_quality_speed_and_independent_ground_truth(self):
        rows=[{'id':str(i),'seconds':60,'genres':['rock','pop','jazz'][i%3:i%3+1],
               'ground_truth':True,'rtf':.2,'metrics':{kind:{'delta':0.,'candidate_dbfs':-50,'baseline_dbfs':-50} for kind in SOURCES}} for i in range(12)]
        self.assertTrue(decide(rows)['approved'])
        self.assertFalse(decide([{**row,'ground_truth':False} for row in rows])['approved'])
        self.assertFalse(decide([{**row,'rtf':2.} for row in rows])['approved'])
        for row in rows:row['metrics']['vocals']['delta']=-2.
        self.assertFalse(decide(rows)['approved'])
        reference=np.sin(np.arange(1000)*.1)
        self.assertGreater(si_sdr(reference,reference),80)
        self.assertIsNone(si_sdr(reference,np.zeros_like(reference)))
