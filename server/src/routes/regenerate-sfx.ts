import { Router } from 'express';
import { getJob } from '../services/job-store.js';
import { generateSoundEffectWithFallback } from '../services/elevenlabs.js';

const router = Router();

router.post('/', async (req, res) => {
  const { jobId, trackId, prompt, durationSec } = req.body ?? {};

  if (!jobId || !trackId || !prompt || typeof durationSec !== 'number') {
    res.status(400).json({ error: 'Missing required fields: jobId, trackId, prompt, durationSec' });
    return;
  }

  const job = getJob(jobId);
  if (!job || !job.result) {
    res.status(404).json({ error: 'Job not found or has no result' });
    return;
  }

  const track = job.result.tracks.find(t => t.id === trackId);
  if (!track) {
    res.status(404).json({ error: 'Track not found' });
    return;
  }

  if (track.type === 'music') {
    res.status(400).json({ error: 'Music tracks cannot be regenerated via this endpoint' });
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing ELEVENLABS_API_KEY' });
    return;
  }

  try {
    const { actualDurationSec, loop } = await generateSoundEffectWithFallback(
      prompt, durationSec, track.filePath, apiKey, 0.6,
    );

    // Update track metadata in-memory (persisted via job store on next event)
    track.actualDurationSec = actualDurationSec;
    track.loop = loop;
    track.prompt = prompt;
    track.label = `${track.type === 'sfx' ? 'SFX' : 'Ambient'}: ${prompt.slice(0, 50)}`;

    res.json({ trackId, actualDurationSec, loop });
  } catch (err: any) {
    console.error(`Failed to regenerate track ${trackId}:`, err.message);
    res.status(500).json({ error: err.message || 'Regeneration failed' });
  }
});

export default router;
