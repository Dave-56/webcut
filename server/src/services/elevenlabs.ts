import { ElevenLabsClient } from 'elevenlabs';
import fs from 'fs';
import path from 'path';
import { getAudioDuration } from './video-utils.js';
import type { SfxCategory } from '../types.js';

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

const MUSIC_API_URL = 'https://api.elevenlabs.io/v1/music';
const MUSIC_PLAN_URL = 'https://api.elevenlabs.io/v1/music/plan';
const MAX_MUSIC_DURATION_MS = 300_000; // 5 minutes (simple prompt path)
const MAX_COMPOSITION_DURATION_MS = 600_000; // 10 minutes (composition plan path)

/**
 * Generate music using ElevenLabs Music API (POST /v1/music).
 */
export async function generateMusic(
  prompt: string,
  durationSec: number,
  outputPath: string,
  apiKey: string,
): Promise<{ actualDurationSec: number; loop: boolean }> {
  const durationMs = Math.min(Math.round(durationSec * 1000), MAX_MUSIC_DURATION_MS);

  const response = await withRetry(async () => {
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
  };
}

// ─── Composition Plan Types ───

interface CompositionSection {
  section_name: string;
  positive_local_styles: string[];
  negative_local_styles: string[];
  duration_ms: number;
  lines: string[];
}

interface CompositionPlan {
  positive_global_styles: string[];
  negative_global_styles: string[];
  sections: CompositionSection[];
}

export interface MusicSegmentInput {
  prompt: string;
  durationSec: number;
  genre: string;
  style: string;
}

/**
 * Call the free /v1/music/plan endpoint to convert a prose prompt
 * into structured style tags. Returns extracted styles from the plan.
 */
async function getStylesFromPlanEndpoint(
  prompt: string,
  durationMs: number,
  apiKey: string,
): Promise<{ positive: string[]; negative: string[] }> {
  const response = await withRetry(async () => {
    const res = await fetch(MUSIC_PLAN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        prompt,
        music_length_ms: Math.min(durationMs, 120_000),
        model_id: 'music_v1',
      }),
    });
    if (!res.ok) {
      const err: any = new Error(`Music Plan API error: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  });

  const plan = await response.json();
  // Merge global + first section styles into a flat list
  const positive = [
    ...(plan.positive_global_styles || []),
    ...(plan.sections?.[0]?.positive_local_styles || []),
  ];
  const negative = [
    ...(plan.negative_global_styles || []),
    ...(plan.sections?.[0]?.negative_local_styles || []),
  ];

  return { positive, negative };
}

/**
 * Generate music using a composition plan. Converts Gemini's music segments
 * into structured sections via the free /v1/music/plan endpoint, then
 * generates one continuous track with section-level control.
 */
export async function generateMusicWithCompositionPlan(
  segments: MusicSegmentInput[],
  globalStyle: string,
  fullVideoPrompt: string,
  totalDurationSec: number,
  outputPath: string,
  apiKey: string,
): Promise<{ actualDurationSec: number; loop: boolean }> {
  // Convert each segment's prose prompt to structured styles via free endpoint
  const sectionPromises = segments.map(async (seg, i) => {
    const enrichedPrompt = `${seg.prompt}. Style: ${globalStyle}. Overall: ${fullVideoPrompt}`;
    const durationMs = Math.round(seg.durationSec * 1000);

    try {
      const styles = await getStylesFromPlanEndpoint(enrichedPrompt, durationMs, apiKey);
      return {
        section_name: `Section ${i + 1}: ${seg.genre}`,
        positive_local_styles: styles.positive,
        negative_local_styles: styles.negative,
        duration_ms: durationMs,
        lines: [],
      };
    } catch {
      // Fallback: use the prose prompt directly as a style tag
      return {
        section_name: `Section ${i + 1}: ${seg.genre}`,
        positive_local_styles: [seg.prompt, seg.genre, seg.style],
        negative_local_styles: [],
        duration_ms: durationMs,
        lines: [],
      };
    }
  });

  const sections = await Promise.all(sectionPromises);

  const compositionPlan: CompositionPlan = {
    positive_global_styles: [
      globalStyle,
      'cinematic', 'film score quality', 'dynamic range',
      'instrumental', 'no vocals',
    ],
    negative_global_styles: [
      'stock music', 'generic corporate', 'lo-fi', 'chiptune',
      'vocals', 'singing', 'lyrics',
    ],
    sections,
  };

  const response = await withRetry(async () => {
    const res = await fetch(`${MUSIC_API_URL}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        composition_plan: compositionPlan,
        model_id: 'music_v1',
        respect_sections_durations: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err: any = new Error(`Music Composition API error: ${res.status} — ${body}`);
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
    loop: totalDurationSec * 1000 > MAX_COMPOSITION_DURATION_MS,
  };
}

/**
 * Generate a sound effect using ElevenLabs Text-to-Sound-Effects API.
 * Caps at 22s (API limit). Returns loop: true for longer requests.
 */
export async function generateSoundEffect(
  description: string,
  durationSec: number,
  category: SfxCategory,
  outputPath: string,
  apiKey: string,
): Promise<{ actualDurationSec: number; loop: boolean }> {
  const elevenLabs = getClient(apiKey);
  const effectiveDuration = Math.min(durationSec, 22);
  const qualityHint = category === 'hard'
    ? 'crisp, prominent, foreground'
    : category === 'ambient'
      ? 'cinematic, continuous, environmental, immersive, background'
      : 'subtle, textural, natural';
  const prompt = `Sound effect: ${description}, ${qualityHint}, ${effectiveDuration} seconds`;

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

function simplifyPrompt(description: string): string {
  const firstClause = description.split(',')[0].trim();
  const words = firstClause.split(/\s+/).slice(0, 8);
  return words.join(' ');
}

/**
 * Wrapper around generateSoundEffect that tries a simplified prompt as fallback
 * after the primary prompt (with its internal retries) fails.
 */
export async function generateSoundEffectWithFallback(
  description: string,
  durationSec: number,
  category: SfxCategory,
  outputPath: string,
  apiKey: string,
): Promise<{ actualDurationSec: number; loop: boolean; usedFallback: boolean; fallbackPrompt?: string; error?: string }> {
  try {
    const result = await generateSoundEffect(description, durationSec, category, outputPath, apiKey);
    return { ...result, usedFallback: false };
  } catch (primaryErr: any) {
    const simplified = simplifyPrompt(description);
    if (simplified === description) {
      throw primaryErr;
    }

    try {
      const result = await generateSoundEffect(simplified, durationSec, category, outputPath, apiKey);
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
