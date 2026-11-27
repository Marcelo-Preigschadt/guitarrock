import hashlib
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from riffsync import config, db, worker
from riffsync.api import app
from riffsync.compute import available_cpus, child_environment, thread_budget


class ComputeTests(unittest.TestCase):
    def test_quota_and_affinity_bound_the_budget(self):
        def read(path):
            if str(path).endswith('cpu.max'): return '200000 100000'
            raise FileNotFoundError()
        with patch('os.cpu_count',return_value=80),patch('os.sched_getaffinity',return_value=set(range(16))),patch.object(Path,'read_text',read),patch.dict(os.environ,{},clear=True):
            self.assertEqual(available_cpus(),2)
            self.assertEqual(thread_budget(),2)
            with patch.dict(os.environ,{'RIFFSYNC_CPU_THREADS':'64'}): self.assertEqual(thread_budget(),2)

    def test_auto_and_explicit_budgets_reach_every_inference_library(self):
        with patch('riffsync.compute.available_cpus',return_value=12),patch.dict(os.environ,{},clear=True):
            self.assertEqual(thread_budget(),8)
            with patch.dict(os.environ,{'RIFFSYNC_CPU_THREADS':'4'}):
                environment=child_environment()
                for key in ('RIFFSYNC_CPU_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS'):
                    self.assertEqual(environment[key],'4')
            with patch.dict(os.environ,{'OMP_NUM_THREADS':'2'}): self.assertEqual(thread_budget(),2)


class EarlyDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.previous=config.DATA;config.DATA=Path(self.temp.name)
        self.client=TestClient(app);self.client.__enter__();worker.stop.clear()
        db.heartbeat('test-worker')
        self.headers={'X-Workspace-Key':'a'*64};self.owner=hashlib.sha256(('a'*64).encode()).hexdigest()

    def tearDown(self):
        self.client.__exit__(None,None,None);config.DATA=self.previous;worker.stop.clear();self.temp.cleanup()

    def separate(self):
        job=db.create(self.owner,'any-song.mp3','htdemucs_6s',True)
        folder=config.DATA/job['id'];folder.mkdir();(folder/'input.mp3').write_bytes(b'original')
        db.update(job['id'],status='queued');job=db.claim('separation')
        def audio(_job,_directory,destination,_quality):
            destination.mkdir()
            for kind in ('vocals','drums','bass','guitar','piano','other'):
                (destination/(kind+'.wav')).write_bytes(b'RIFF-original-'+kind.encode())
            return {'quality':'studio'},[]
        with patch('riffsync.worker.duration',return_value=240),patch('riffsync.worker.command') as commands,patch('riffsync.worker.separate_audio',side_effect=audio):
            worker.process(job)
        self.assertFalse(any('riffsync.transcribe' in call.args[0] for call in commands.call_args_list))
        return db.get(job['id'])

    def test_audio_is_downloadable_before_notes_start_then_notes_arrive_without_reseparation(self):
        job=self.separate()
        self.assertEqual(job['status'],'completed');self.assertEqual(job['analysis_state'],'queued')
        url=f"/api/jobs/{job['id']}/files/guitar.wav"
        original=self.client.get(url,headers=self.headers).content
        self.assertEqual(original,b'RIFF-original-guitar')
        claimed=db.claim_analysis('notes');self.assertIsNone(db.claim_analysis('duplicate'))
        def analyze(args,*_args,**_kwargs):
            self.assertIn('riffsync.transcribe',args);self.assertNotIn('riffsync.separate',args)
            self.assertEqual(self.client.get(url,headers=self.headers).content,original)
            transcription={'bpm':120,'timing':None,'chords':[{'start':0,'end':1,'label':'Em'}],
                           'notes':{'guitar':[{'start':0,'end':1,'pitch':64,'velocity':.8}]},'warnings':[]}
            (config.DATA/job['id']/'output'/'transcription.json').write_text(json.dumps(transcription))
        with patch('riffsync.worker.command',side_effect=analyze):worker.process_analysis(claimed)
        result=db.get(job['id'])
        self.assertEqual(result['analysis_state'],'ready');self.assertTrue(result['result']['analysis_revision'])
        self.assertEqual(result['result']['chords'][0]['label'],'Em')
        self.assertEqual(self.client.get(url,headers=self.headers).content,original)

    def test_cancelling_analysis_preserves_audio_and_rejects_a_late_notation_result(self):
        job=self.separate();claimed=db.claim_analysis('notes')
        url=f"/api/jobs/{job['id']}/analysis/cancel"
        self.assertEqual(self.client.post(url,headers={'X-Workspace-Key':'b'*64}).status_code,404)
        self.assertEqual(self.client.post(url,headers=self.headers).json()['status'],'completed')
        with self.assertRaises(worker.Cancelled):worker.check_job(job['id'],analysis=True)
        db.update(job['id'],analysis_state='ready',result={'tracks':[]})
        current=db.get(job['id'])
        self.assertEqual(current['analysis_state'],'cancelled');self.assertEqual(len(current['result']['tracks']),6)
        response=self.client.post(url.removesuffix('/cancel'),headers=self.headers)
        self.assertEqual(response.status_code,202);self.assertEqual(response.json()['analysis_state'],'queued')
        self.assertEqual(response.json()['id'],claimed['id'])

    def test_worker_recovery_requeues_only_the_unfinished_analysis(self):
        job=self.separate();claimed=db.claim_analysis('dead')
        claimed['updated']=time.time()-100
        with db.connect() as connection:
            connection.execute('UPDATE jobs SET payload=? WHERE id=?',(json.dumps(claimed),job['id']))
        db.recover();current=db.get(job['id'])
        self.assertEqual(current['status'],'completed');self.assertEqual(current['analysis_state'],'queued')
        self.assertEqual(current['result'],job['result']);self.assertIsNone(db.claim('separation'))

    def test_a_cancelled_generation_cannot_overwrite_a_new_analysis_request(self):
        job=self.separate();old=db.claim_analysis('notes')
        db.update(job['id'],analysis_state='cancelled')
        new=db.request_analysis(job['id'])
        self.assertNotEqual(new['analysis_token'],old['analysis_token'])
        with self.assertRaises(worker.Cancelled):
            worker.check_job(job['id'],analysis=True,analysis_token=old['analysis_token'])
        db.update(job['id'],expected_analysis_token=old['analysis_token'],analysis_state='ready',result={'tracks':[]})
        current=db.get(job['id'])
        self.assertEqual(current['analysis_state'],'queued');self.assertEqual(len(current['result']['tracks']),6)
