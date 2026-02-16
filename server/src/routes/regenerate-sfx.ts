import { Router, type Router as RouterType } from 'express';
import fsp from 'fs/promises';
import { getJob } from '../services/job-store.js';
import { generateSoundEffectWithFallback } from '../services/elevenlabs.js';
import { normalizeAudio, LOUDNORM_TARGETS, TRUE_PEAK_DBTP } from '../services/video-utils.js';
import { rewritePrompt } from '../services/prompt-rewriter.js';

const router: RouterType = Router();

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
    // Optimize prompt for ElevenLabs via ChatGPT rewriter
    const optimizedPrompt = await rewritePrompt({
      prompt,
      type: track.type as 'sfx' | 'ambient',
      loop: track.loop,
      durationSec,
    });

    const { actualDurationSec, loop } = await generateSoundEffectWithFallback(
      optimizedPrompt, durationSec, track.filePath, apiKey, 0.6, track.loop,
    );

    // Normalize loudness to match the rest of the mix (EBU R128)
    const lufsTarget = LOUDNORM_TARGETS[track.type] ?? LOUDNORM_TARGETS.sfx;
    const normalizedPath = track.filePath.replace(/(\.\w+)$/, '_norm$1');
    try {
      const result = await normalizeAudio(track.filePath, normalizedPath, lufsTarget, TRUE_PEAK_DBTP);
      if (result !== track.filePath) {
        await fsp.rename(normalizedPath, track.filePath);
      }
    } catch (normErr: any) {
      console.warn(`Loudness normalization failed for regenerated track ${trackId}:`, normErr.message);
    }

    // Update track metadata in-memory (persisted via job store on next event)
    track.actualDurationSec = actualDurationSec;
    track.loop = loop;
    track.prompt = optimizedPrompt;
    track.originalPrompt = prompt;
    track.label = `${track.type === 'sfx' ? 'SFX' : 'Ambient'}: ${prompt.slice(0, 50)}`;

    res.json({ trackId, actualDurationSec, loop, originalPrompt: prompt, optimizedPrompt });
  } catch (err: any) {
    console.error(`Failed to regenerate track ${trackId}:`, err.message);
    res.status(500).json({ error: err.message || 'Regeneration failed' });
  }
});

export default router;
