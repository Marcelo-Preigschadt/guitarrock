import importlib.util
import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

AVAILABLE=all(importlib.util.find_spec(name) for name in ('demucs','torch','numpy','soundfile'))
if AVAILABLE:
    import numpy as np
    import soundfile as sf
    import torch
    from riffsync.separate import run,file_digest


@unittest.skipUnless(AVAILABLE,'AI libraries required; inference is mocked')
class SeparationResumeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.source=self.root/'original.wav'
        sf.write(self.source,np.full((1000,2),.5),44100,subtype='FLOAT')

    def tearDown(self):self.temp.cleanup()

    def infer(self,audio,name,targets,*args):
        value=random.random()*.1
        return targets,torch.stack([torch.full_like(audio,value) for _ in targets])

    def test_resume_skips_completed_models_and_retains_the_same_random_predictions(self):
        folder=self.root/'resumed'
        def interrupted(audio,name,targets,*args):
            if name=='melband-kimberley-vocals':raise RuntimeError('interrupted')
            return self.infer(audio,name,targets,*args)
        with patch('riffsync.separate.infer',side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):run(self.source,folder,'htdemucs_6s','studio','cpu')
        with patch('riffsync.separate.infer',side_effect=self.infer) as infer:
            metadata=run(self.source,folder,'htdemucs_6s','studio','cpu')
        self.assertEqual(infer.call_count,3)
        self.assertTrue(metadata['stages'][0]['reused'])
        with patch('riffsync.separate.infer',side_effect=self.infer):
            run(self.source,self.root/'fresh','htdemucs_6s','studio','cpu')
        for kind in ('vocals','drums','bass','guitar','piano','other'):
            self.assertEqual(file_digest(folder/(kind+'.wav')),file_digest(self.root/'fresh'/(kind+'.wav')))
        with patch('riffsync.separate.infer') as infer:
            cached=run(self.source,folder,'htdemucs_6s','studio','cpu')
            infer.assert_not_called();self.assertTrue(cached['reused_complete_result'])

    def test_source_changes_and_corrupted_wavs_invalidate_completed_cache(self):
        folder=self.root/'result'
        with patch('riffsync.separate.infer',side_effect=self.infer):run(self.source,folder,'htdemucs_6s','studio','cpu')
        (folder/'guitar.wav').write_bytes(b'corrupt')
        with patch('riffsync.separate.infer',side_effect=self.infer) as infer:run(self.source,folder,'htdemucs_6s','studio','cpu')
        self.assertEqual(infer.call_count,4)
        sf.write(self.source,np.full((1000,2),.25),44100,subtype='FLOAT')
        with patch('riffsync.separate.infer',side_effect=self.infer) as infer:run(self.source,folder,'htdemucs_6s','studio','cpu')
        self.assertEqual(infer.call_count,4)
