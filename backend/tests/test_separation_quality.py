import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

AVAILABLE = all(importlib.util.find_spec(name) for name in ('demucs', 'torch', 'soundfile', 'numpy'))
if AVAILABLE:
    import numpy as np
    import soundfile as sf
    import torch
    from riffsync.separate import finalize, infer, model_plan
    from riffsync.media import waveform


@unittest.skipUnless(AVAILABLE, 'AI dependencies required; models are mocked in unit tests')
class SeparationQualityTests(unittest.TestCase):
    def test_shared_gain_preserves_balance_and_reconstructs_mix_without_clipping(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); raw = root/'raw'; raw.mkdir()
            time = np.arange(44100*2)/44100
            mix = np.column_stack((.6*np.sin(time*880), .3*np.sin(time*1320))).astype('float32')
            # Deliberate model overshoot: reducing each stem independently breaks the sum.
            vocals = mix*4
            drums = mix*.2
            sf.write(root/'mix.wav', mix, 44100, subtype='FLOAT')
            sf.write(raw/'vocals.wav', vocals, 44100, subtype='FLOAT')
            sf.write(raw/'drums.wav', drums, 44100, subtype='FLOAT')
            metadata = finalize(root/'mix.wav', raw, root/'output', ['vocals','drums','other'])
            result = {kind: sf.read(root/'output'/f'{kind}.wav', dtype='float32')[0] for kind in ('vocals','drums','other')}
            self.assertLess(metadata['gain'], 1)
            self.assertLessEqual(max(float(np.max(np.abs(value))) for value in result.values()), .980001)
            np.testing.assert_allclose(result['vocals'], vocals*metadata['gain'], atol=1.3e-7)
            np.testing.assert_allclose(result['drums'], drums*metadata['gain'], atol=1.3e-7)
            np.testing.assert_allclose(sum(result.values()), mix*metadata['gain'], atol=4e-7)
            self.assertLess(metadata['reconstruction_peak_error'], 4e-7)
            self.assertEqual(sf.info(root/'output'/'vocals.wav').subtype, 'PCM_24')
            self.assertEqual(len(waveform(root/'output'/'vocals.wav')), 220)

    def test_invalid_model_output_is_rejected_before_publication(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); raw = root/'raw'; raw.mkdir()
            sf.write(root/'mix.wav', np.zeros((441,2)), 44100, subtype='FLOAT')
            sf.write(raw/'vocals.wav', np.full((441,2), np.nan), 44100, subtype='FLOAT')
            with self.assertRaisesRegex(ValueError, 'inválidas'):
                finalize(root/'mix.wav', raw, root/'output', ['vocals','other'])
            self.assertFalse((root/'output'/'vocals.wav').exists())

    def test_studio_keeps_guitar_and_piano_and_uses_original_mix_specialists(self):
        plan = model_plan('htdemucs_6s', 'studio')
        self.assertEqual(plan[0], ('htdemucs_6s', ['guitar','piano','drums']))
        self.assertEqual(dict(plan[1:]), {'melband-kimberley-vocals':['vocals'],'f7e0c4bc':['drums'],'d12395a8':['bass']})
        self.assertEqual(len(model_plan('htdemucs', 'studio')), 3)

    def test_shift_averaging_uses_the_same_original_and_handles_silence(self):
        class Model:
            sources = ['drums','bass','other','vocals']
            segment = 7.8
            def cpu(self): return self
            def eval(self): return self
            def to(self, _device): return self
        calls = []
        def fake_apply(_model, mix, **options):
            calls.append((mix.clone(), options))
            # Opposite perturbations cancel, representing equivariant averaging.
            result = torch.zeros(1,4,2,100)
            result[:,3] = 1 if len(calls)==1 else -1
            return result
        with patch('riffsync.separate.get_model', return_value=Model()), patch('riffsync.separate.apply_model', side_effect=fake_apply):
            names, output = infer(torch.zeros(2,100), 'test', ['vocals'], 'cpu', 2, .5, 7.8, lambda _: None)
        self.assertEqual(names,['vocals'])
        self.assertTrue(torch.isfinite(output).all())
        self.assertEqual(output.abs().max().item(), 0)
        self.assertTrue(torch.equal(calls[0][0], calls[1][0]))
        self.assertEqual(calls[0][1]['segment'],7.8)

    def test_roformer_overlap_preserves_alignment_stereo_and_both_boundaries(self):
        from riffsync.melband import overlap_infer
        for length in (1,37,100,101,252,600):
            with self.subTest(length=length):
                original = torch.randn(2,length)
                saved = original.clone()
                progress = []
                result = overlap_infer(lambda x:x,original,'cpu',progress.append,chunk=100)
                torch.testing.assert_close(result,original,atol=3e-7,rtol=1e-6)
                torch.testing.assert_close(original,saved)
                self.assertEqual(progress[-1],1.)

    def test_roformer_download_is_verified_atomic_and_cached(self):
        import io, hashlib
        from riffsync import melband
        data = b'verified model fixture'
        with tempfile.TemporaryDirectory() as temp, patch.object(melband,'SHA256',hashlib.sha256(data).hexdigest()):
            with patch('riffsync.melband.urllib.request.urlopen',return_value=io.BytesIO(data)) as download:
                file = melband.checkpoint(Path(temp))
                self.assertEqual(file.read_bytes(),data)
                self.assertEqual(melband.checkpoint(Path(temp)),file)
                self.assertEqual(download.call_count,1)
            # A corrupt cached model is not passed to torch.load; a corrupt
            # replacement never overwrites it or leaves a partial target.
            file.write_bytes(b'corrupt')
            with patch('riffsync.melband.urllib.request.urlopen',return_value=io.BytesIO(b'bad response')):
                with self.assertRaisesRegex(ValueError,'SHA256'):melband.checkpoint(Path(temp))
            self.assertEqual(file.read_bytes(),b'corrupt')
            self.assertFalse(list(Path(temp).glob('*.part')))

    def test_six_stem_pipeline_blends_drum_estimates_without_extra_model_pass(self):
        from riffsync.separate import run
        def fake_infer(audio,name,targets,*args):
            levels = {'vocals':.1,'drums':.8 if name=='htdemucs_6s' else .4,'bass':.15,'guitar':.2,'piano':.3}
            return targets, torch.stack([torch.full_like(audio,levels[kind]) for kind in targets])
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            sf.write(root/'original.wav', np.full((1000,2),.5),44100,subtype='FLOAT')
            # A failed attempt may have left raw audio from a different window.
            # The first model must overwrite it before the specialist ensemble.
            (root/'result'/'raw').mkdir(parents=True)
            sf.write(root/'result'/'raw'/'drums.wav',np.full((1000,2),.2),44100,subtype='FLOAT')
            with patch('riffsync.separate.infer',side_effect=fake_infer) as inference:
                metadata=run(root/'original.wav',root/'result','htdemucs_6s','studio','cpu')
            drums,_=sf.read(root/'result'/'drums.wav')
            np.testing.assert_allclose(drums,.6,atol=1.3e-7)
            self.assertEqual(inference.call_count,4)
            self.assertEqual(metadata['drum_ensemble'],{'htdemucs_6s':.5,'f7e0c4bc':.5})
            self.assertEqual(len(list((root/'result').glob('*.wav'))),6)


if __name__ == '__main__': unittest.main()
