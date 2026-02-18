import { Router, type Router as RouterType } from 'express';
import fsp from 'fs/promises';
import { getJob } from '../services/job-store.js';
import { generateDubbedSpeech } from '../services/elevenlabs.js';
import { normalizeAudio, LOUDNORM_TARGETS, TRUE_PEAK_DBTP } from '../services/video-utils.js';

const router: RouterType = Router();

router.post('/', async (req, res) => {
  const { jobId, trackId, text, speakerLabel, emotion, voiceId } = req.body ?? {};

  if (!jobId || !trackId || !text) {
    res.status(400).json({ error: 'Missing required fields: jobId, trackId, text' });
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

  if (track.type !== 'dialogue') {
    res.status(400).json({ error: 'Only dialogue tracks can be regenerated via this endpoint' });
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing ELEVENLABS_API_KEY' });
    return;
  }

  try {
    const { actualDurationSec } = await generateDubbedSpeech(
      text,
      'en',
      speakerLabel || track.speakerLabel || 'speaker_1',
      track.requestedDurationSec,
      track.filePath,
      apiKey,
      emotion || track.emotion,
      voiceId, // Pass explicit override; generateDubbedSpeech falls back to speaker lookup
    );

    // Normalize loudness to match the rest of the mix (EBU R128)
    const lufsTarget = LOUDNORM_TARGETS.dialogue;
    const normalizedPath = track.filePath.replace(/(\.\w+)$/, '_norm$1');
    try {
      const result = await normalizeAudio(track.filePath, normalizedPath, lufsTarget, TRUE_PEAK_DBTP);
      if (result !== track.filePath) {
        await fsp.rename(normalizedPath, track.filePath);
      }
    } catch (normErr: any) {
      console.warn(`Loudness normalization failed for regenerated dialogue ${trackId}:`, normErr.message);
    }

    // Update track metadata in-memory
    track.actualDurationSec = actualDurationSec;
    track.text = text;
    if (speakerLabel) track.speakerLabel = speakerLabel;
    if (emotion) track.emotion = emotion;
    track.label = `${track.speakerLabel ?? 'Speaker'}: ${text.slice(0, 40)}`;

    res.json({ trackId, actualDurationSec, text });
  } catch (err: any) {
    console.error(`Failed to regenerate dialogue ${trackId}:`, err.message);
    res.status(500).json({ error: err.message || 'Dialogue regeneration failed' });
  }
});

export default router;
