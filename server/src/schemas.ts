import { z } from 'zod';

// ─── Pass 1: Story Analysis Schema ───

const StoryBeatSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  description: z.string().default(''),
  emotion: z.string().default('neutral'),
});

const SpeechSegmentSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  text: z.string().default(''),
  language: z.string().default('en'),
  speakerLabel: z.string().default('speaker_1'),
});

export const StoryAnalysisSchema = z.object({
  summary: z.string().default(''),
  genre: z.string().default('general'),
  setting: z.string().default(''),
  emotionalArc: z.string().default(''),
  beats: z.array(StoryBeatSchema).default([]),
  speechSegments: z.array(SpeechSegmentSchema).default([]),
  durationSec: z.number().default(0),
});

// ─── Pass 2: Sound Design Plan Schema ───

const MusicMixLevelSchema = z.enum(['off', 'low', 'medium', 'high']).default('medium');

const SoundDesignSceneSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  description: z.string().default(''),
  mood: z.string().default('neutral'),
  dialogue: z.boolean().default(false),
  music_level: MusicMixLevelSchema,
});

const MusicSegmentSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  prompt: z.string().default(''),
  genre: z.string().default('cinematic'),
  style: z.string().default('instrumental'),
  skip: z.boolean().default(false),
  loop: z.boolean().default(false),
});

const SfxCategorySchema = z.enum(['hard', 'soft', 'ambient']).default('hard');

const SfxSegmentSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  prompt: z.string().default(''),
  category: SfxCategorySchema,
  volume: z.number().min(0).max(1).default(0.7),
  skip: z.boolean().default(false),
});

export const SoundDesignPlanSchema = z.object({
  scenes: z.array(SoundDesignSceneSchema).default([]),
  music_segments: z.array(MusicSegmentSchema).default([]),
  sfx_segments: z.array(SfxSegmentSchema).default([]),
  full_video_music_prompt: z.string().default(''),
  global_music_style: z.string().default('cinematic'),
});
