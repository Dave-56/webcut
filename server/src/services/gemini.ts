import { GoogleAIFileManager } from '@google/generative-ai/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { StoryAnalysis, SoundDesignPlan, SpeechSegment } from '../types.js';
import { StoryAnalysisSchema, SoundDesignPlanSchema } from '../schemas.js';

const MODEL = 'gemini-3-pro-preview';

// ─── Pass 1: Story Analysis (multimodal) ───

const STORY_ANALYSIS_PROMPT = `You are a story analyst. Watch this video carefully — every frame, every sound — and describe what happens in vivid, sensory detail.

Your job is ONLY to describe the story. Do NOT suggest any sounds, music, or audio design. Just tell me what you see and hear.

Return a JSON object with this exact structure:
{
  "summary": "<2-3 sentence summary of the entire video>",
  "genre": "<genre: drama, comedy, action, documentary, commercial, tutorial, music-video, horror, romance, sci-fi, animation, other>",
  "setting": "<overall setting/location description>",
  "emotionalArc": "<describe how the emotional tone shifts across the video, e.g. 'starts calm, builds tension, resolves peacefully'>",
  "beats": [
    {
      "startTime": <seconds>,
      "endTime": <seconds>,
      "description": "<VIVID description of what happens — include specific visual details, body language, camera movement, lighting changes, textures, weather, energy level. Be evocative and sensory, not clinical. This description is the ONLY thing a sound designer will read to design audio for this moment.>",
      "emotion": "<the dominant emotional tone: tense, peaceful, energetic, melancholic, joyful, dramatic, mysterious, romantic, comedic, hopeful, anxious, triumphant, somber, whimsical, neutral>",
      "significance": "<major|minor|transition — 'major' for key story moments, 'transition' for scene changes, 'minor' for everything else>",
      "environment": "<physical environment: indoor office, outdoor forest, busy street, quiet bedroom, underwater, etc. Be specific about the acoustic character of the space.>"
    }
  ],
  "speechSegments": [
    {
      "startTime": <seconds>,
      "endTime": <seconds>,
      "text": "<transcribed speech>",
      "language": "<language code: en, zh, es, fr, etc.>",
      "speakerLabel": "<speaker_1, speaker_2, etc.>"
    }
  ],
  "durationSec": <total video duration in seconds>
}

Rules:
- Beats must cover the entire video duration without gaps
- Write beat descriptions as if painting a picture for someone who will never see the video — they need to FEEL the moment from your words alone
- Include details about: movement (fast/slow, camera/subject), lighting (bright/dark, warm/cool), energy level (building/falling/static), texture of the environment, any notable visual elements
- Only include speechSegments if actual speech is detected
- Return ONLY the JSON object, no markdown code blocks`;

// ─── Pass 2: Sound Design Plan (text-only) ───

const SOUND_DESIGN_PROMPT = `You are a world-class sound designer. Based on the story analysis below, create a sound design plan covering background music and sound effects.

Two guiding principles:
1. Support the EMOTIONAL ARC — music should amplify what the audience should feel
2. Let key moments BREATHE — not every second needs a sound effect; silence is powerful

STORY ANALYSIS:
{STORY_JSON}

IMPORTANT CONSTRAINTS:
- Music segments should be at least 10 seconds long for quality
- Music can be up to 5 minutes (300 seconds) per segment
- Music CAN span multiple scenes if the emotional tone is consistent — don't cut music at every scene boundary
- Sound effects are either "hard" (prominent, foreground: door slam, gunshot, glass break) or "soft" (texture, background: rustling clothes, distant traffic hum, keyboard clicks)
- Sound effects are limited to a maximum of 22 seconds per clip

Return a JSON object with this exact structure:
{
  "scenes": [
    {
      "startTime": <seconds>,
      "endTime": <seconds>,
      "description": "<what's happening in this scene>",
      "mixHierarchy": {
        "dialogue": <0-1, relative volume for dialogue in this scene>,
        "music": <0-1, relative volume for music>,
        "sfx": <0-1, relative volume for sound effects>
      }
    }
  ],
  "sfx": [
    {
      "time": <seconds>,
      "duration": <seconds, 1-15>,
      "description": "<specific sound effect prompt for audio generation — be precise and descriptive>",
      "category": "<hard|soft>"
    }
  ],
  "music": [
    {
      "startTime": <seconds>,
      "endTime": <seconds>,
      "prompt": "<detailed music generation prompt: include mood, instruments, tempo, energy, style. Example: 'Gentle acoustic guitar with soft piano, slow tempo, warm and nostalgic, slight melancholy, like a sunset memory'. Be specific about instruments and feel — this prompt goes directly to a music generation AI.>",
      "genre": "<genre of the music piece>",
      "style": "<instrumental, vocal, electronic, orchestral, etc.>",
      "loop": <true if the segment is longer than 300 seconds>
    }
  ]
}

Rules:
- Scenes should cover the entire video duration
- Music segments can span multiple scenes — use your artistic judgment about when the music mood needs to change
- For music longer than 300 seconds, set loop to true
- Music prompts should be rich and evocative — describe the instruments, tempo, energy, mood, and style. They are fed directly to a music generation AI.
- SFX should be selective — only include sounds that meaningfully contribute to the experience
- SFX are capped at 22 seconds each
- mixHierarchy values should reflect the relative importance of each audio layer in that scene (e.g., during dialogue, music should be lower)
- Return ONLY the JSON object, no markdown code blocks`;

const TRANSLATION_PROMPT = (targetLang: string) =>
  `Translate the following speech segments to ${targetLang}. Keep the same JSON array structure, only modify the "text" field with the translation and update "language" to "${targetLang}". Return ONLY the JSON array, no markdown code blocks.`;

// ─── File Upload Helper (Pass 1 only) ───

interface FileRef {
  fileData: { fileUri: string; mimeType: string };
}

export async function uploadMediaFiles(
  framePaths: string[],
  audioPath: string | null,
  apiKey: string,
  signal?: AbortSignal,
): Promise<FileRef[]> {
  const fileManager = new GoogleAIFileManager(apiKey);
  const fileRefs: FileRef[] = [];

  // Upload frames in batches of 10
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

  // Upload audio if available
  if (audioPath && fs.existsSync(audioPath)) {
    const audioUpload = await fileManager.uploadFile(audioPath, {
      mimeType: 'audio/wav',
      displayName: 'video_audio.wav',
    });
    fileRefs.push({
      fileData: {
        fileUri: audioUpload.file.uri,
        mimeType: 'audio/wav',
      },
    });
  }

  return fileRefs;
}

// ─── Pass 1: Story Analysis ───

export async function analyzeStory(
  fileRefs: FileRef[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<StoryAnalysis> {
  if (signal?.aborted) throw new Error('Aborted');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });

  const parts: any[] = [...fileRefs, { text: STORY_ANALYSIS_PROMPT }];

  const result = await model.generateContent(parts);
  const text = result.response.text();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      raw = JSON.parse(jsonMatch[1].trim());
    } else {
      throw new Error(`Failed to parse story analysis JSON: ${text.slice(0, 200)}`);
    }
  }

  const parsed = StoryAnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('Story analysis validation warnings:', parsed.error.issues);
    return StoryAnalysisSchema.parse(raw);
  }

  return parsed.data;
}

// ─── Pass 2: Sound Design Plan (text-only) ───

export async function createSoundDesignPlan(
  storyAnalysis: StoryAnalysis,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SoundDesignPlan> {
  if (signal?.aborted) throw new Error('Aborted');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
    },
  });

  const prompt = SOUND_DESIGN_PROMPT.replace('{STORY_JSON}', JSON.stringify(storyAnalysis, null, 2));

  const result = await model.generateContent([{ text: prompt }]);
  const text = result.response.text();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      raw = JSON.parse(jsonMatch[1].trim());
    } else {
      throw new Error(`Failed to parse sound design plan JSON: ${text.slice(0, 200)}`);
    }
  }

  const parsed = SoundDesignPlanSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('Sound design plan validation warnings:', parsed.error.issues);
    return SoundDesignPlanSchema.parse(raw);
  }

  return parsed.data;
}

// ─── Translation (unchanged) ───

export async function translateSpeechSegments(
  segments: SpeechSegment[],
  targetLanguage: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SpeechSegment[]> {
  if (!segments.length) return [];
  if (signal?.aborted) throw new Error('Aborted');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3-pro-preview',
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
