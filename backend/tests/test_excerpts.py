import hashlib
import io
import math
import shutil
import struct
import tempfile
import unittest
import wave
from pathlib import Path
from fastapi.testclient import TestClient
from riffsync import config, db
from riffsync.api import app

@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg required')
class ExcerptTests(unittest.TestCase):
    def test_private_bounded_cached_reference_without_new_separation(self):
        previous=config.DATA
        with tempfile.TemporaryDirectory() as temporary:
            config.DATA=Path(temporary)
            try:
                with TestClient(app) as client:
                    headers={'X-Workspace-Key':'a'*64}
                    job=db.create(hashlib.sha256(('a'*64).encode()).hexdigest(),'song.mp3','htdemucs',False)
                    folder=config.DATA/job['id']/'output';folder.mkdir(parents=True);source=folder/'guitar.wav'
                    with wave.open(str(source),'wb') as audio:
                        audio.setparams((2,2,44100,0,'NONE','not compressed'))
                        audio.writeframes(b''.join(struct.pack('<hh',v,v) for v in (round(5000*math.sin(2*math.pi*220*i/44100)) for i in range(44100*4))))
                    original=source.read_bytes();db.update(job['id'],status='completed',result={'tracks':[{'file':'guitar.wav'}]})
                    url=f"/api/jobs/{job['id']}/excerpt/guitar.wav?start=1&seconds=2"
                    response=client.get(url,headers=headers);self.assertEqual(response.status_code,200)
                    with wave.open(io.BytesIO(response.content),'rb') as audio:
                        self.assertEqual((audio.getnchannels(),audio.getframerate(),audio.getsampwidth()),(1,48000,2))
                        self.assertAlmostEqual(audio.getnframes()/48000,2,delta=.01)
                    cache=next((folder/'excerpts').glob('*.wav'));modified=cache.stat().st_mtime_ns
                    self.assertEqual(client.get(url,headers=headers).content,response.content);self.assertEqual(cache.stat().st_mtime_ns,modified)
                    self.assertEqual(client.get(url,headers={'X-Workspace-Key':'b'*64}).status_code,404)
                    self.assertEqual(client.get(url.replace('guitar.wav','private.wav'),headers=headers).status_code,404)
                    for query in ['start=-1&seconds=2','start=NaN&seconds=2','start=0&seconds=21','start=0&seconds=inf','start=9&seconds=2']:
                        self.assertEqual(client.get(url.split('?')[0]+'?'+query,headers=headers).status_code,422,query)
                    self.assertEqual(source.read_bytes(),original);self.assertEqual(db.get(job['id'])['status'],'completed')
            finally: config.DATA=previous
