import { z } from 'zod';

// ─── Pass 1: Story Analysis Schema ───

const StoryBeatSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  description: z.string().default(''),
  emotion: z.string().default('neutral'),
  significance: z.enum(['major', 'minor', 'transition']).default('minor'),
  environment: z.string().default(''),
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

const MixHierarchySchema = z.object({
  dialogue: z.number().min(0).max(1).default(1.0),
  music: z.number().min(0).max(1).default(0.4),
  sfx: z.number().min(0).max(1).default(0.7),
});

const SoundDesignSceneSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  description: z.string().default(''),
  mixHierarchy: MixHierarchySchema.default({
    dialogue: 1.0,
    music: 0.4,
    sfx: 0.7,
  }),
});

const PlannedSfxSchema = z.object({
  time: z.number(),
  duration: z.number(),
  description: z.string().default(''),
  category: z.enum(['hard', 'soft']).default('hard'),
});

const PlannedMusicSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  prompt: z.string().default(''),
  genre: z.string().default('cinematic'),
  style: z.string().default('instrumental'),
  loop: z.boolean().default(false),
});

export const SoundDesignPlanSchema = z.object({
  scenes: z.array(SoundDesignSceneSchema).default([]),
  sfx: z.array(PlannedSfxSchema).default([]),
  music: z.array(PlannedMusicSchema).default([]),
});
