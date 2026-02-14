import { ElevenLabsClient } from 'elevenlabs';
import fs from 'fs';
import path from 'path';
import { getAudioDuration } from './video-utils.js';

let client: ElevenLabsClient | null = null;

function getClient(apiKey: string): ElevenLabsClient {
  if (!client) {
    client = new ElevenLabsClient({ apiKey });
  }
  return client;
}

// Default voices for dubbing (speaker label → voice ID mapping)
const SPEAKER_VOICES: Record<string, string> = {
  speaker_1: 'JBFqnCBsd6RMkjVDRZzb',  // George
  speaker_2: 'EXAVITQu4vr4xnSDxMaL',  // Sarah
  speaker_3: 'onwK4e9ZLuTAKqWW03F9',  // Daniel
  speaker_4: 'XB0fDUnXU5powFXDhCwa',  // Charlotte
};

const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

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

const MUSIC_API_URL = 'https://api.elevenlabs.io/v1/music';
const MAX_MUSIC_DURATION_MS = 300_000; // 5 minutes

/**
 * Generate music using ElevenLabs Music API (POST /v1/music).
 */
export async function generateMusic(
  prompt: string,
  durationSec: number,
  outputPath: string,
  apiKey: string,
): Promise<{ actualDurationSec: number; loop: boolean; retryCount: number }> {
  const durationMs = Math.min(Math.round(durationSec * 1000), MAX_MUSIC_DURATION_MS);

  const { result: response, attempts } = await withRetry(async () => {
    const res = await fetch(`${MUSIC_API_URL}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        prompt,
        music_length_ms: durationMs,
        model_id: 'music_v1',
        force_instrumental: true,
      }),
    });
    if (!res.ok) {
      const err: any = new Error(`Music API error: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);

  const actualDuration = await getAudioDuration(outputPath);

  return {
    actualDurationSec: actualDuration,
    loop: durationSec * 1000 > MAX_MUSIC_DURATION_MS,
    retryCount: attempts - 1,
  };
}

/**
 * Enrich short prompts so the SFX API generates clearer, more realistic audio.
 * If the prompt is under 60 chars, append production-quality descriptors.
 */
function enrichShortPrompt(description: string): string {
  if (description.length >= 60) return description;
  return `${description}, clear recording, close-mic, realistic sound design`;
}

export interface SoundEffectApiParams {
  text: string;
  duration_seconds: number;
  prompt_influence: number;
}

/**
 * Generate a sound effect using ElevenLabs Text-to-Sound-Effects API.
 * Caps at 22s (API limit). Returns loop: true for longer requests.
 * Also returns the exact params sent to the API for logging.
 */
export async function generateSoundEffect(
  description: string,
  durationSec: number,
  outputPath: string,
  apiKey: string,
  promptInfluence = 0.5,
): Promise<{
  actualDurationSec: number;
  loop: boolean;
  retryCount: number;
  apiSent: SoundEffectApiParams;
}> {
  const elevenLabs = getClient(apiKey);
  const effectiveDuration = Math.min(durationSec, 22);
  const enrichedPrompt = enrichShortPrompt(description);
  const textSent = enrichedPrompt.slice(0, 200);
  const apiSent: SoundEffectApiParams = {
    text: textSent,
    duration_seconds: effectiveDuration,
    prompt_influence: promptInfluence,
  };

  const { result: audio, attempts } = await withRetry(() =>
    elevenLabs.textToSoundEffects.convert({
      text: textSent,
      duration_seconds: effectiveDuration,
      prompt_influence: promptInfluence,
    }),
  );

  await saveStreamToFile(audio, outputPath);
  const actualDuration = await getAudioDuration(outputPath);

  return {
    actualDurationSec: actualDuration,
    loop: durationSec > 22,
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
 */
export async function generateSoundEffectWithFallback(
  description: string,
  durationSec: number,
  outputPath: string,
  apiKey: string,
  promptInfluence = 0.5,
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
    const result = await generateSoundEffect(description, durationSec, outputPath, apiKey, promptInfluence);
    return { ...result, usedFallback: false };
  } catch (primaryErr: any) {
    const simplified = simplifyPrompt(description);
    if (simplified === description) {
      throw primaryErr;
    }

    try {
      const result = await generateSoundEffect(simplified, durationSec, outputPath, apiKey, promptInfluence);
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
 */
export async function generateDubbedSpeech(
  text: string,
  targetLanguage: string,
  speakerLabel: string,
  targetDurationSec: number,
  outputPath: string,
  apiKey: string,
): Promise<{ actualDurationSec: number }> {
  const elevenLabs = getClient(apiKey);
  const voiceId = SPEAKER_VOICES[speakerLabel] || DEFAULT_VOICE;

  const modelId = 'eleven_turbo_v2_5'; // Multilingual model

  const { result: audio } = await withRetry(() =>
    elevenLabs.textToSpeech.convert(voiceId, {
      text,
      model_id: modelId,
      output_format: 'mp3_44100_128',
    }),
  );

  await saveStreamToFile(audio, outputPath);
  const actualDuration = await getAudioDuration(outputPath);

  return { actualDurationSec: actualDuration };
}
