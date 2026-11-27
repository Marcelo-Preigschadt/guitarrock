import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from riffsync import config
from riffsync.api import app


class RecoveryTests(unittest.TestCase):
    def test_recovery_is_available_without_frontend_build_or_workspace_key(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(config, 'DATA', Path(folder)):
            with TestClient(app) as client:
                response = client.get('/api/recover')
                self.assertEqual(response.status_code, 200)
                self.assertIn('text/html', response.headers['content-type'])
                self.assertEqual(response.headers['cache-control'], 'no-store')
                self.assertIn('Recuperar e abrir estúdio', response.text)
                self.assertNotIn('/api/recover', client.get('/openapi.json').json()['paths'])

    def test_recovery_does_not_change_uploaded_files(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(config, 'DATA', Path(folder)):
            with TestClient(app) as client:
                upload = Path(folder) / 'saved-song.mp3'
                upload.write_bytes(b'original-song')
                client.get('/api/recover')
                self.assertEqual(upload.read_bytes(), b'original-song')
