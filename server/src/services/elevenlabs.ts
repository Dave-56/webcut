import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'fs';
import path from 'path';
import { getAudioDuration } from './video-utils.js';
import type { SpeakerMeta, SpeakerGender } from '../types.js';

let client: ElevenLabsClient | null = null;

function getClient(apiKey: string): ElevenLabsClient {
  if (!client) {
    client = new ElevenLabsClient({ apiKey });
  }
  return client;
}

// Gender-indexed voice pool for deterministic assignment
const VOICES_BY_GENDER: Record<SpeakerGender, { id: string; name: string }[]> = {
  male: [
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },
  ],
  female: [
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
    { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte' },
  ],
  neutral: [
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
  ],
};

const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

// Legacy mapping kept for backward compatibility
const SPEAKER_VOICES: Record<string, string> = {
  speaker_1: 'JBFqnCBsd6RMkjVDRZzb',
  speaker_2: 'EXAVITQu4vr4xnSDxMaL',
  speaker_3: 'onwK4e9ZLuTAKqWW03F9',
  speaker_4: 'XB0fDUnXU5powFXDhCwa',
};

/**
 * Deterministically assign ElevenLabs voice IDs to speakers based on gender.
 * Speakers are sorted alphabetically by label for consistency across runs.
 * Mutates speakers in-place and returns them.
 */
export function assignVoices(speakers: SpeakerMeta[]): SpeakerMeta[] {
  const sorted = [...speakers].sort((a, b) => a.label.localeCompare(b.label));
  const usedByGender: Record<string, number> = { male: 0, female: 0, neutral: 0 };

  for (const speaker of sorted) {
    const gender = speaker.gender || 'neutral';
    const pool = VOICES_BY_GENDER[gender] || VOICES_BY_GENDER.neutral;
    const index = usedByGender[gender] % pool.length;
    speaker.voiceId = pool[index].id;
    usedByGender[gender]++;
  }

  // Apply back to the original array (sorted was a copy for ordering)
  for (const speaker of speakers) {
    const match = sorted.find(s => s.label === speaker.label);
    if (match) speaker.voiceId = match.voiceId;
  }

  return speakers;
}

/** v3 stability: 0.0 = Creative (varied), 0.5 = Natural, 1.0 = Robust (consistent).
 *  We default to Creative for maximum expressiveness from Audio Tags. */
const TTS_STABILITY = 0.0;

/** Retry with exponential backoff for API rate limits and transient errors */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<{ result: T; attempts: number }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt + 1 };
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const status = err.status || err.statusCode || err.response?.status;
      if (status === 429 || (status && status >= 500)) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err; // non-retryable
    }
  }
  throw new Error('Unreachable');
}

/** Save a ReadableStream or async iterator to a file */
async function saveStreamToFile(stream: any, outputPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Handle different response types from ElevenLabs SDK
  if (stream instanceof Buffer) {
    fs.writeFileSync(outputPath, stream);
    return;
  }

  if (typeof stream[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    fs.writeFileSync(outputPath, Buffer.concat(chunks));
    return;
  }

  if (stream instanceof ReadableStream || (stream && typeof stream.getReader === 'function')) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    fs.writeFileSync(outputPath, Buffer.concat(chunks));
    return;
  }

  // Fallback: assume it's already a buffer-like
  fs.writeFileSync(outputPath, Buffer.from(stream));
}

const MAX_MUSIC_DURATION_MS = 300_000; // 5 minutes

/**
 * Generate music using ElevenLabs Music API via the official SDK.
 */
export async function generateMusic(
  prompt: string,
  durationSec: number,
  outputPath: string,
  apiKey: string,
): Promise<{ actualDurationSec: number; loop: boolean; retryCount: number }> {
  const elevenLabs = getClient(apiKey);
  const durationMs = Math.min(Math.round(durationSec * 1000), MAX_MUSIC_DURATION_MS);

  const { result: audio, attempts } = await withRetry(() =>
    elevenLabs.music.compose({
      outputFormat: 'mp3_44100_128',
      prompt,
      musicLengthMs: durationMs,
      modelId: 'music_v1',
      forceInstrumental: true,
    }),
  );

  await saveStreamToFile(audio, outputPath);
  const actualDuration = await getAudioDuration(outputPath);

  return {
    actualDurationSec: actualDuration,
    loop: durationSec * 1000 > MAX_MUSIC_DURATION_MS,
    retryCount: attempts - 1,
  };
}

export interface SoundEffectApiParams {
  text: string;
  durationSeconds: number;
  promptInfluence: number;
  loop: boolean;
}

/**
 * Generate a sound effect using ElevenLabs Text-to-Sound-Effects API.
 * Caps at 30s (API limit). Returns loop: true for longer requests or when
 * shouldLoop is set. When shouldLoop is true, passes loop: true to the API
 * so the generated audio is designed to repeat seamlessly (no audible seam).
 */
export async function generateSoundEffect(
  description: string,
  durationSec: number,
  outputPath: string,
  apiKey: string,
  promptInfluence = 0.5,
  shouldLoop = false,
): Promise<{
  actualDurationSec: number;
  loop: boolean;
  retryCount: number;
  apiSent: SoundEffectApiParams;
}> {
  const elevenLabs = getClient(apiKey);
  const effectiveDuration = Math.min(durationSec, 30);
  const textSent = description.slice(0, 200);
  const needsLoop = shouldLoop || durationSec > 30;
  const apiSent: SoundEffectApiParams = {
    text: textSent,
    durationSeconds: effectiveDuration,
    promptInfluence,
    loop: needsLoop,
  };

  const { result: audio, attempts } = await withRetry(() =>
    elevenLabs.textToSoundEffects.convert({
      text: textSent,
      durationSeconds: effectiveDuration,
      promptInfluence,
      loop: needsLoop,
    }),
  );

  await saveStreamToFile(audio, outputPath);
  const actualDuration = await getAudioDuration(outputPath);

  return {
    actualDurationSec: actualDuration,
    loop: needsLoop,
    retryCount: attempts - 1,
    apiSent,
  };
}

function simplifyPrompt(description: string): string {
  const firstClause = description.split(',')[0].trim();
  const words = firstClause.split(/\s+/).slice(0, 8);
  return words.join(' ');
}

/**
 * Wrapper around generateSoundEffect that tries a simplified prompt as fallback
 * after the primary prompt (with its internal retries) fails.
 * Returns apiSent (exact params sent to ElevenLabs) for audit logging.
 * Pass shouldLoop to generate seamlessly loopable audio via the ElevenLabs API.
 */
export async function generateSoundEffectWithFallback(
  description: string,
  durationSec: number,
  outputPath: string,
  apiKey: string,
  promptInfluence = 0.5,
  shouldLoop = false,
): Promise<{
  actualDurationSec: number;
  loop: boolean;
  retryCount: number;
  usedFallback: boolean;
  fallbackPrompt?: string;
  error?: string;
  apiSent: SoundEffectApiParams;
}> {
  try {
    const result = await generateSoundEffect(description, durationSec, outputPath, apiKey, promptInfluence, shouldLoop);
    return { ...result, usedFallback: false };
  } catch (primaryErr: any) {
    const simplified = simplifyPrompt(description);
    if (simplified === description) {
      throw primaryErr;
    }

    try {
      const result = await generateSoundEffect(simplified, durationSec, outputPath, apiKey, promptInfluence, shouldLoop);
      return {
        ...result,
        usedFallback: true,
        fallbackPrompt: simplified,
        error: primaryErr.message,
      };
    } catch {
      throw primaryErr;
    }
  }
}

/**
 * Generate dubbed speech using ElevenLabs TTS.
 * Supports emotion via stability tuning and text-prefix hints.
 * voiceId override takes precedence over speakerLabel lookup.
 */
export async function generateDubbedSpeech(
  text: string,
  targetLanguage: string,
  speakerLabel: string,
  targetDurationSec: number,
  outputPath: string,
  apiKey: string,
  emotion?: string,
  voiceId?: string,
): Promise<{ actualDurationSec: number; voiceId: string }> {
  const elevenLabs = getClient(apiKey);
  const resolvedVoiceId = voiceId || SPEAKER_VOICES[speakerLabel] || DEFAULT_VOICE;

  const modelId = 'eleven_v3';

  const stability = TTS_STABILITY;

  // Embed emotion hint in text for better delivery
  const ttsText = emotion && emotion !== 'neutral'
    ? `[${emotion}] ${text}`
    : text;

  const { result: audio } = await withRetry(() =>
    elevenLabs.textToSpeech.convert(resolvedVoiceId, {
      text: ttsText,
      modelId,
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability,
      },
    }),
  );

  await saveStreamToFile(audio, outputPath);
  const actualDuration = await getAudioDuration(outputPath);

  return { actualDurationSec: actualDuration, voiceId: resolvedVoiceId };
}
