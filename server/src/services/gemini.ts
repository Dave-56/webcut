import { GoogleAIFileManager } from '@google/generative-ai/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { SceneAnalysis } from '../types.js';

const ANALYSIS_PROMPT = `You are a professional sound designer analyzing a video for automated sound design.

Analyze the provided video frames and audio to produce a detailed sound design breakdown.

Return a JSON object with this exact structure:
{
  "scenes": [
    {
      "startTime": <number, seconds from start>,
      "endTime": <number, seconds>,
      "description": "<brief scene description>",
      "mood": "<one of: tense, peaceful, energetic, melancholic, joyful, dramatic, mysterious, romantic, comedic, neutral>",
      "suggestedAmbience": "<ambient sound description, e.g. 'forest birds chirping', 'busy city traffic', 'ocean waves'>"
    }
  ],
  "speechSegments": [
    {
      "startTime": <number, seconds>,
      "endTime": <number, seconds>,
      "text": "<transcribed speech>",
      "language": "<detected language code, e.g. 'en', 'zh', 'es'>",
      "speakerLabel": "<speaker_1, speaker_2, etc.>"
    }
  ],
  "soundEffects": [
    {
      "time": <number, seconds>,
      "duration": <number, seconds, typically 1-5>,
      "description": "<specific sound effect description, e.g. 'door slam', 'footsteps on gravel', 'glass breaking'>"
    }
  ],
  "overallMood": "<dominant mood of the entire video>"
}

Rules:
- Scenes should cover the entire video duration without gaps
- Be specific in ambience and sound effect descriptions (they'll be used as generation prompts)
- Only include speechSegments if actual speech is detected in the audio
- Sound effects should be specific, actionable sounds visible in the frames
- Return ONLY the JSON object, no markdown code blocks or extra text`;

const TRANSLATION_PROMPT = (targetLang: string) =>
  `Translate the following speech segments to ${targetLang}. Keep the same JSON array structure, only modify the "text" field with the translation and update "language" to "${targetLang}". Return ONLY the JSON array, no markdown code blocks.`;

export async function analyzeVideo(
  framePaths: string[],
  audioPath: string | null,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SceneAnalysis> {
  const fileManager = new GoogleAIFileManager(apiKey);
  const genAI = new GoogleGenerativeAI(apiKey);

  if (signal?.aborted) throw new Error('Aborted');

  // Upload frames via File API to avoid huge payloads
  const fileRefs: Array<{ fileData: { fileUri: string; mimeType: string } }> = [];

  // Upload frames in batches of 10 for parallelism
  const BATCH_SIZE = 10;
  for (let i = 0; i < framePaths.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new Error('Aborted');
    const batch = framePaths.slice(i, i + BATCH_SIZE);
    const uploads = await Promise.all(
      batch.map(async (framePath) => {
        const upload = await fileManager.uploadFile(framePath, {
          mimeType: 'image/jpeg',
          displayName: path.basename(framePath),
        });
        return {
          fileData: {
            fileUri: upload.file.uri,
            mimeType: 'image/jpeg',
          },
        };
      }),
    );
    fileRefs.push(...uploads);
  }

  // Build content parts: all frame references + optional audio + prompt
  const parts: any[] = [...fileRefs];

  // Upload and include audio if available
  if (audioPath && fs.existsSync(audioPath)) {
    const audioUpload = await fileManager.uploadFile(audioPath, {
      mimeType: 'audio/wav',
      displayName: 'video_audio.wav',
    });
    parts.push({
      fileData: {
        fileUri: audioUpload.file.uri,
        mimeType: 'audio/wav',
      },
    });
  }

  parts.push({ text: ANALYSIS_PROMPT });

  if (signal?.aborted) throw new Error('Aborted');

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });

  const result = await model.generateContent(parts);
  const text = result.response.text();

  // Parse the JSON response
  let analysis: SceneAnalysis;
  try {
    analysis = JSON.parse(text);
  } catch {
    // Try to extract JSON from potential markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      analysis = JSON.parse(jsonMatch[1].trim());
    } else {
      throw new Error(`Failed to parse Gemini response as JSON: ${text.slice(0, 200)}`);
    }
  }

  // Validate basic structure
  if (!analysis.scenes || !Array.isArray(analysis.scenes)) {
    analysis.scenes = [];
  }
  if (!analysis.speechSegments || !Array.isArray(analysis.speechSegments)) {
    analysis.speechSegments = [];
  }
  if (!analysis.soundEffects || !Array.isArray(analysis.soundEffects)) {
    analysis.soundEffects = [];
  }
  if (!analysis.overallMood) {
    analysis.overallMood = 'neutral';
  }

  return analysis;
}

export async function translateSpeechSegments(
  segments: SceneAnalysis['speechSegments'],
  targetLanguage: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SceneAnalysis['speechSegments']> {
  if (!segments.length) return [];
  if (signal?.aborted) throw new Error('Aborted');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
    },
  });

  const result = await model.generateContent([
    { text: TRANSLATION_PROMPT(targetLanguage) },
    { text: JSON.stringify(segments) },
  ]);

  const text = result.response.text();
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    throw new Error(`Failed to parse translation response: ${text.slice(0, 200)}`);
  }
}
