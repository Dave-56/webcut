import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import type { GlobalSonicContext } from '../types.js';

// ─── Load meta-prompt from external file at startup ───

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(
  path.resolve(__dirname, '../prompts/elevenlabs-rewriter.txt'),
  'utf-8',
);

// ─── OpenAI client (lazy singleton) ───

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!client) {
    client = new OpenAI({ apiKey });
  }
  return client;
}

// ─── Types ───

export interface RewriteItem {
  prompt: string;
  type: 'sfx' | 'ambient';
  loop: boolean;
  durationSec: number;
}

// ─── Zod validation for the response ───

const RewriteResponseSchema = z.array(
  z.string().min(1).max(200),
);

// ─── Retry logic (OpenAI-specific error handling) ───

async function withOpenAIRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const status = err.status ?? err.statusCode ?? err.response?.status;
      const isRetryable = status === 429 || (status && status >= 500);
      if (isRetryable) {
        const delay = Math.pow(2, attempt) * 1500 + Math.random() * 500;
        console.warn(
          `OpenAI retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms (${status})`,
        );
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unreachable');
}

// ─── Build the user message for the batch call ───

function buildUserMessage(
  items: RewriteItem[],
  sonicContext?: GlobalSonicContext,
): string {
  const parts: string[] = [];

  if (sonicContext) {
    parts.push(`SONIC_CONTEXT:\n${JSON.stringify(sonicContext, null, 2)}\n`);
  }

  parts.push('ITEMS:');
  parts.push(JSON.stringify(
    items.map((item, i) => ({
      index: i,
      prompt: item.prompt,
      type: item.type,
      loop: item.loop,
      durationSec: item.durationSec,
    })),
    null,
    2,
  ));

  parts.push(
    `\nReturn a JSON array of ${items.length} rewritten prompt strings, in the same order. ` +
    'Each must be 200 characters or fewer. Return ONLY the JSON array, nothing else.',
  );

  return parts.join('\n');
}

// ─── Core batch rewrite ───

/**
 * Rewrite an array of sound prompts for optimal ElevenLabs generation.
 * Returns an array of rewritten prompts in the same order.
 * Falls back to original prompts if OpenAI is unavailable or fails.
 */
export async function rewritePrompts(
  items: RewriteItem[],
  sonicContext?: GlobalSonicContext,
  signal?: AbortSignal,
): Promise<string[]> {
  if (items.length === 0) return [];

  const originals = items.map(i => i.prompt);

  const openai = getClient();
  if (!openai) {
    console.warn('Prompt rewriter skipped: OPENAI_API_KEY not set');
    return originals;
  }

  try {
    const userMessage = buildUserMessage(items, sonicContext);

    const response = await withOpenAIRetry(() =>
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
      }, { signal }),
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn('Prompt rewriter: empty response from OpenAI');
      return originals;
    }

    // Parse the response — handle both bare arrays and wrapped objects
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn('Prompt rewriter: invalid JSON from OpenAI:', content.slice(0, 200));
      return originals;
    }

    // If the model wrapped the array in an object, extract the array
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const values = Object.values(parsed as Record<string, unknown>);
      if (values.length === 1 && Array.isArray(values[0])) {
        parsed = values[0];
      }
    }

    const validated = RewriteResponseSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn(
        'Prompt rewriter: response validation failed:',
        validated.error.issues.slice(0, 3),
      );
      return originals;
    }

    if (validated.data.length !== items.length) {
      console.warn(
        `Prompt rewriter: expected ${items.length} prompts, got ${validated.data.length}`,
      );
      return originals;
    }

    return validated.data;
  } catch (err: any) {
    if (err.name === 'AbortError' || signal?.aborted) {
      throw err;
    }
    console.warn('Prompt rewriter failed, using originals:', err.message);
    return originals;
  }
}

/**
 * Rewrite a single prompt. Convenience wrapper for the regenerate route.
 */
export async function rewritePrompt(
  item: RewriteItem,
  signal?: AbortSignal,
): Promise<string> {
  const results = await rewritePrompts([item], undefined, signal);
  return results[0];
}
