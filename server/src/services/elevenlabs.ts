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
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
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

/**
 * Generate background music using ElevenLabs Sound Effects API.
 * For scenes > 20s, generates a ~20s clip and marks it as loopable.
 */
export async function generateBackgroundMusic(
  mood: string,
  durationSec: number,
  outputPath: string,
  apiKey: string,
): Promise<{ actualDurationSec: number; loop: boolean }> {
  const elevenLabs = getClient(apiKey);
  const effectiveDuration = Math.min(durationSec, 22);
  const prompt = `Background music, ${mood} mood, cinematic, ${effectiveDuration} seconds, instrumental, no vocals`;

  const audio = await withRetry(() =>
    elevenLabs.textToSoundEffects.convert({
      text: prompt,
      duration_seconds: effectiveDuration,
    }),
  );

  await saveStreamToFile(audio, outputPath);
  const actualDuration = await getAudioDuration(outputPath);

  return {
    actualDurationSec: actualDuration,
    loop: durationSec > 22,
  };
}

/**
 * Generate a sound effect.
 */
export async function generateSoundEffect(
  description: string,
  durationSec: number,
  outputPath: string,
  apiKey: string,
): Promise<{ actualDurationSec: number }> {
  const elevenLabs = getClient(apiKey);
  const effectiveDuration = Math.min(durationSec, 22);
  const prompt = `Sound effect: ${description}, ${effectiveDuration} seconds`;

  const audio = await withRetry(() =>
    elevenLabs.textToSoundEffects.convert({
      text: prompt,
      duration_seconds: effectiveDuration,
    }),
  );

  await saveStreamToFile(audio, outputPath);
  const actualDuration = await getAudioDuration(outputPath);

  return { actualDurationSec: actualDuration };
}

/**
 * Generate ambient sound.
 * For long scenes, generates a ~20s clip marked as loopable.
 */
export async function generateAmbience(
  description: string,
  durationSec: number,
  outputPath: string,
  apiKey: string,
): Promise<{ actualDurationSec: number; loop: boolean }> {
  const elevenLabs = getClient(apiKey);
  const effectiveDuration = Math.min(durationSec, 22);
  const prompt = `Ambient sound: ${description}, continuous, ${effectiveDuration} seconds, loop-friendly`;

  const audio = await withRetry(() =>
    elevenLabs.textToSoundEffects.convert({
      text: prompt,
      duration_seconds: effectiveDuration,
    }),
  );

  await saveStreamToFile(audio, outputPath);
  const actualDuration = await getAudioDuration(outputPath);

  return {
    actualDurationSec: actualDuration,
    loop: durationSec > 22,
  };
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

  // Map language codes to ElevenLabs model IDs
  const modelId = 'eleven_turbo_v2_5'; // Multilingual model

  const audio = await withRetry(() =>
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
