import hashlib
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from riffsync import config, db
from riffsync.api import app
from riffsync.fingering import assign_strings

KEY = "a" * 64
HEADERS = {"X-Workspace-Key": KEY}
OWNER = hashlib.sha256(KEY.encode()).hexdigest()

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = config.DATA
        config.DATA = Path(self.temp.name)
        self.client = TestClient(app)
        self.client.__enter__()
    def tearDown(self):
        self.client.__exit__(None, None, None)
        config.DATA = self.previous
        self.temp.cleanup()
    def job(self):
        return db.create(OWNER, "test.mp3", "htdemucs", False)

    def test_health_does_not_claim_worker_without_heartbeat(self):
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['worker_online'])

    def test_upload_does_not_enter_claimable_queue_until_complete(self):
        job = self.job()
        self.assertIsNone(db.claim('worker'))
        db.update(job['id'], status='queued')
        self.assertEqual(db.claim('worker')['id'], job['id'])
        self.assertIsNone(db.claim('another-worker'))

    def test_jobs_require_workspace_and_are_isolated(self):
        job = self.job()
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}").status_code, 401)
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}", headers={'X-Workspace-Key':'b'*64}).status_code, 404)
        response = self.client.get(f"/api/jobs/{job['id']}", headers=HEADERS)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('filename', response.json())

    def test_cancellation_wins_over_worker_completion(self):
        job = self.job()
        self.client.post(f"/api/jobs/{job['id']}/cancel", headers=HEADERS)
        db.update(job['id'], status='completed', result={'tracks':[]})
        self.assertEqual(db.get(job['id'])['status'], 'cancelled')

    def test_audio_download_is_manifest_allowlisted(self):
        job = self.job()
        out = config.DATA / job['id'] / 'output'; out.mkdir(parents=True)
        (out / 'guitar.wav').write_bytes(b'RIFF-test-fixture')
        (out / 'private.log').write_text('not exposed')
        db.update(job['id'], status='completed', result={'tracks':[{'file':'guitar.wav'}]})
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}/files/guitar.wav", headers=HEADERS).status_code, 200)
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}/files/private.log", headers=HEADERS).status_code, 404)
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}/files/guitar.wav", headers={'X-Workspace-Key':'b'*64}).status_code, 404)

    def test_queue_limit_is_checked_atomically(self):
        self.job(); self.job()
        with self.assertRaises(ValueError): self.job()

    def test_stale_worker_recovers_job_as_failed(self):
        job = self.job(); db.update(job['id'], status='queued'); db.claim('dead-worker')
        payload = db.get(job['id']); payload['updated'] = time.time() - 120
        import json
        with db.connect() as c: c.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps(payload), job['id']))
        db.recover()
        self.assertEqual(db.get(job['id'])['status'], 'failed')

    def test_upload_limits_and_success(self):
        with patch('riffsync.api.importlib.util.find_spec', return_value=object()), patch('riffsync.api.db.worker_online', return_value=True):
            response = self.client.post('/api/jobs', headers=HEADERS, files={'file':('audio.mp3', b'test-audio', 'audio/mpeg')})
            self.assertEqual(response.status_code, 202)
            job = db.get(response.json()['id'])
            self.assertEqual(job['status'], 'queued')
            self.assertEqual((config.DATA / job['id'] / 'input.mp3').read_bytes(), b'test-audio')
            with patch.object(config, 'MAX_UPLOAD', 2):
                response = self.client.post('/api/jobs', headers=HEADERS, files={'file':('large.mp3', b'12345', 'audio/mpeg')})
                self.assertEqual(response.status_code, 413)

    def test_missing_worker_returns_actionable_error(self):
        response = self.client.post('/api/jobs', headers=HEADERS, files={'file':('audio.mp3', b'test', 'audio/mpeg')})
        self.assertEqual(response.status_code, 503)

    def test_fingering_never_assigns_two_simultaneous_notes_to_one_string(self):
        notes = [{'start':0, 'end':1, 'midi':m, 'velocity':0.8} for m in (40, 47, 52, 55, 59, 64)]
        result = assign_strings(notes)
        assigned = [n for n in result if 'string' in n]
        self.assertEqual(len({n['string'] for n in assigned}), len(assigned))
        for n in assigned: self.assertTrue(0 <= n['fret'] <= 24)

if __name__ == '__main__':
    unittest.main()
