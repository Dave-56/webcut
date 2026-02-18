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

// ─── Pass 1.5: Action Spotting Schema ───

const SpottedActionSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  action: z.string().default(''),
  sound: z.string().default(''),
  loop: z.boolean().default(false),
});

export const ActionSpottingSchema = z.object({
  actions: z.array(SpottedActionSchema).default([]),
});

// ─── Pass 1.75: Global Sonic Context Schema ───

export const GlobalSonicContextSchema = z.object({
  environment_type: z.string().default(''),
  primary_location: z.string().default(''),
  scale: z.string().default(''),
  realism_style: z.string().default(''),
  acoustic_character: z.string().default(''),
  energy_profile: z.string().default(''),
  perspective: z.string().default(''),
  era: z.string().default(''),
});

// ─── Pass 2: Sound Design Plan Schema ───

const MusicMixLevelSchema = z.enum(['off', 'low', 'medium', 'high']).default('medium');
const LoudnessClassSchema = z.enum(['quiet', 'moderate', 'loud']).default('moderate');

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

const AmbientSegmentSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  prompt: z.string().default(''),
  loudness_class: LoudnessClassSchema,
  loop: z.boolean().default(true),
});

export const SoundDesignPlanSchema = z.object({
  scenes: z.array(SoundDesignSceneSchema).default([]),
  music_segments: z.array(MusicSegmentSchema).default([]),
  ambient_segments: z.array(AmbientSegmentSchema).default([]),
  full_video_music_prompt: z.string().default(''),
  global_music_style: z.string().default('cinematic'),
});

// ─── Pass 3: Dialogue Plan Schema ───

const SpeakerGenderSchema = z.enum(['male', 'female', 'neutral']).default('neutral');

const SpeakerMetaSchema = z.object({
  label: z.string(),
  name: z.string().default('Speaker'),
  gender: SpeakerGenderSchema,
  vocalQuality: z.string().default('neutral'),
  voiceId: z.string().optional(),
});

const DialogueLineSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  speakerLabel: z.string(),
  text: z.string().default(''),
  emotion: z.string().default('neutral'),
  voiceId: z.string().optional(),
});

export const DialoguePlanSchema = z.object({
  speakers: z.array(SpeakerMetaSchema).default([]),
  lines: z.array(DialogueLineSchema).default([]),
});
