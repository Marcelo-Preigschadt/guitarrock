import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from riffsync import config, db, worker
from riffsync.api import app

class RevisionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.previous=config.DATA; config.DATA=Path(self.tmp.name)
        self.client=TestClient(app);self.client.__enter__();worker.stop.clear()
        self.headers={'X-Workspace-Key':'a'*64}; owner=hashlib.sha256(('a'*64).encode()).hexdigest()
        self.job=db.create(owner,'music.mp3','htdemucs_6s',True)
        folder=config.DATA/self.job['id']; (folder/'output').mkdir(parents=True);(folder/'input.mp3').write_bytes(b'unchanged MP3')
        tracks=[]
        for kind in ('vocals','drums','bass','guitar','piano','other'):
            (folder/'output'/f'{kind}.wav').write_bytes(kind.encode())
            tracks.append({'id':kind,'kind':kind,'name':kind,'file':f'{kind}.wav','notes':[{'pitch':64,'start':0,'end':1}]})
        db.update(self.job['id'],status='completed',result={'duration':10,'bpm':120,'tracks':tracks,'chords':[]})
        db.heartbeat('test')
    def tearDown(self):
        self.client.__exit__(None,None,None);config.DATA=self.previous;self.tmp.cleanup();worker.stop.clear()
    def revise(self,operation):
        with patch("riffsync.api.importlib.util.find_spec",return_value=object()):
            return self.client.post(f"/api/jobs/{self.job['id']}/revise",headers=self.headers,data={'operation':operation})
    def test_revision_is_isolated_idempotent_and_reuses_existing_audio(self):
        response=self.revise('chords');self.assertEqual(response.status_code,202)
        child=response.json();self.assertEqual(self.revise('chords').json()['id'],child['id'])
        self.assertEqual(child['source_job'],self.job['id'])
        self.assertEqual((config.DATA/child['id']/'input.mp3').read_bytes(),b'unchanged MP3')
        self.assertEqual((config.DATA/child['id']/'output'/'guitar.wav').read_bytes(),b'guitar')
        self.assertEqual(self.client.post(f"/api/jobs/{self.job['id']}/revise",headers={'X-Workspace-Key':'b'*64}).status_code,404)
    def test_chord_recovery_does_not_call_demucs_or_change_notes_or_stems(self):
        child=self.revise('chords').json();job=db.claim('worker')
        def child_command(args,*_args,**_kwargs):
            self.assertNotIn('demucs',args)
            self.assertIn('--chords-only',args)
            (config.DATA/child['id']/'output'/'transcription.json').write_text(json.dumps({'bpm':120,'timing':None,'chords':[{'start':0,'end':10,'label':'Em'}],'warnings':[]}))
        with patch('riffsync.worker.command',side_effect=child_command):worker.process(job)
        result=db.get(child['id'])
        self.assertEqual(result['status'],'completed');self.assertEqual(result['result']['chords'][0]['label'],'Em')
        self.assertEqual(result['result']['tracks'][0]['notes'][0]['pitch'],64)
        self.assertEqual((config.DATA/self.job['id']/'output'/'guitar.wav').read_bytes(),b'guitar')
    def test_refinement_replaces_only_vocals_and_drums_and_preserves_parent(self):
        child=self.revise('vocals_drums').json();job=db.claim('worker');called=[]
        def child_command(args,*_args,**_kwargs):
            if 'demucs' in args:
                kind=args[args.index('--two-stems')+1];signature=args[args.index('-n')+1];called.append((kind,signature))
                folder=config.DATA/child['id']/'refined'/signature/'source';folder.mkdir(parents=True)
                (folder/f'{kind}.wav').write_bytes(f'new {kind}'.encode())
            elif '--chords-only' in args:
                (config.DATA/child['id']/'output'/'transcription.json').write_text(json.dumps({'bpm':120,'timing':None,'chords':[],'warnings':[]}))
        with patch('riffsync.worker.command',side_effect=child_command),patch.object(config,'DEVICE','cpu'):worker.process(job)
        self.assertEqual(called,[('vocals','04573f0d'),('drums','f7e0c4bc')])
        for kind in ('vocals','drums','bass','guitar','piano','other'):
            self.assertEqual((config.DATA/self.job['id']/'output'/f'{kind}.wav').read_bytes(),kind.encode())
            self.assertEqual((config.DATA/child['id']/'output'/f'{kind}.wav').read_bytes(),(f'new {kind}' if kind in ('vocals','drums') else kind).encode())

    def test_quality_revision_replaces_all_audio_and_keeps_parent_and_notation(self):
        parent=db.get(self.job['id'])
        lyrics=[{'start':0,'end':1,'text':'Original lyric'}]
        db.update(self.job['id'],result={**parent['result'],'lyrics':lyrics})
        child=self.revise('quality').json()
        self.assertEqual(self.revise('quality').json()['id'],child['id'])
        job=db.claim('worker')
        def separate(job, directory, destination, quality):
            self.assertEqual(quality,'studio')
            self.assertEqual((directory/'input.mp3').read_bytes(),b'unchanged MP3')
            destination.mkdir()
            for track in db.get(self.job['id'])['result']['tracks']:
                (destination/track['file']).write_bytes(b'new '+track['kind'].encode())
            return {'quality':'studio','engine':'original-mix-v2'},[]
        def harmony(args,*_args,**_kwargs):
            if '--chords-only' in args: raise RuntimeError('Harmony unavailable')
        with patch('riffsync.worker.separate_audio',side_effect=separate),patch('riffsync.worker.command',side_effect=harmony):
            worker.process(job)
        result=db.get(child['id'])
        self.assertEqual(result['status'],'completed')
        self.assertEqual(result['result']['separation']['quality'],'studio')
        self.assertEqual(result['result']['lyrics'],lyrics)
        self.assertEqual(result['lyrics_state'],'ready')
        self.assertIn('cifra anterior',result['warnings'][0])
        for track in result['result']['tracks']:
            self.assertEqual(track['notes'][0]['pitch'],64)
            self.assertEqual((config.DATA/child['id']/'output'/track['file']).read_bytes(),b'new '+track['kind'].encode())
            self.assertEqual((config.DATA/self.job['id']/'output'/track['file']).read_bytes(),track['kind'].encode())

    def test_incomplete_quality_revision_never_publishes_or_changes_parent(self):
        child=self.revise('quality').json();job=db.claim('worker')
        def separate(job,directory,destination,quality):
            destination.mkdir();(destination/'vocals.wav').write_bytes(b'new voice')
            return {'quality':'studio'},[]
        with patch('riffsync.worker.separate_audio',side_effect=separate),patch('riffsync.worker.command'):
            with self.assertRaisesRegex(RuntimeError,'todas as faixas'):worker.process(job)
        self.assertNotEqual(db.get(child['id'])['status'],'completed')
        self.assertEqual((config.DATA/self.job['id']/'output'/'vocals.wav').read_bytes(),b'vocals')
        self.assertEqual((config.DATA/child['id']/'output'/'vocals.wav').read_bytes(),b'vocals')

    def test_quality_revision_requires_original_recording(self):
        (config.DATA/self.job['id']/'input.mp3').unlink()
        self.assertEqual(self.revise('quality').status_code,409)
