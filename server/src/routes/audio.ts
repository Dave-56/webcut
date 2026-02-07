import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getJob } from '../services/job-store.js';

const router = Router();

router.get('/:jobId/:trackId', (req, res) => {
  const { jobId, trackId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  if (!job.result) {
    res.status(404).json({ error: 'Job has no results yet' });
    return;
  }

  const track = job.result.tracks.find(t => t.id === trackId);
  if (!track) {
    res.status(404).json({ error: 'Track not found' });
    return;
  }

  if (!fs.existsSync(track.filePath)) {
    res.status(404).json({ error: 'Audio file not found on disk' });
    return;
  }

  // Determine content type from extension
  const ext = path.extname(track.filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
  };
  const contentType = contentTypes[ext] || 'audio/mpeg';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Disposition', `inline; filename="${track.id}${ext}"`);

  const stat = fs.statSync(track.filePath);
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(track.filePath);
  stream.pipe(res);
});

export default router;
