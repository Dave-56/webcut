// ─── Pass 1: Story Analysis ───

export interface StoryBeat {
  startTime: number;      // seconds
  endTime: number;
  description: string;
  emotion: string;
}

export interface SpeechSegment {
  startTime: number;
  endTime: number;
  text: string;
  language: string;
  speakerLabel: string;
}

export interface StoryAnalysis {
  summary: string;
  genre: string;
  setting: string;
  emotionalArc: string;
  beats: StoryBeat[];
  speechSegments: SpeechSegment[];
  durationSec: number;
}

// ─── Pass 2: Sound Design Plan ───

export type MusicMixLevel = 'off' | 'low' | 'medium' | 'high';

export type SfxCategory = 'hard' | 'soft' | 'ambient';

export interface SoundDesignScene {
  startTime: number;
  endTime: number;
  description: string;
  mood: string;
  dialogue: boolean;
  music_level: MusicMixLevel;
}

export interface MusicSegment {
  startTime: number;
  endTime: number;
  prompt: string;
  genre: string;
  style: string;
  skip: boolean;
  loop: boolean;
}

export interface SfxSegment {
  startTime: number;
  endTime: number;
  prompt: string;
  category: SfxCategory;
  volume: number;
  skip: boolean;
}

export interface SoundDesignPlan {
  scenes: SoundDesignScene[];
  music_segments: MusicSegment[];
  sfx_segments: SfxSegment[];
  full_video_music_prompt: string;
  global_music_style: string;
}

// ─── Generated Output ───

export interface GeneratedTrack {
  id: string;
  type: 'music' | 'sfx';
  filePath: string;
  startTimeSec: number;
  actualDurationSec: number;
  requestedDurationSec: number;
  loop: boolean;
  label: string;
  volume: number;
  genre?: string;
  style?: string;
  skip?: boolean;
  category?: SfxCategory;
}

export interface TrackGenerationResult {
  planned: {
    type: 'music' | 'sfx';
    prompt: string;
    startTimeSec: number;
    durationSec: number;
  };
  status: 'success' | 'fallback' | 'failed';
  track?: GeneratedTrack;
  error?: string;
  fallbackPrompt?: string;
  retryCount: number;
}

export interface GenerationStats {
  planned: number;
  succeeded: number;
  fallback: number;
  failed: number;
}

export interface GenerationReport {
  music: { results: TrackGenerationResult[]; stats: GenerationStats };
  sfx: { results: TrackGenerationResult[]; stats: GenerationStats };
}

export interface SoundDesignResult {
  storyAnalysis: StoryAnalysis;
  soundDesignPlan: SoundDesignPlan;
  tracks: GeneratedTrack[];
  generationReport?: GenerationReport;
}

export interface JobProgress {
  stage: 'uploading' | 'uploading_to_gemini' | 'analyzing_story' | 'analyzing_sound_design' | 'generating' | 'complete' | 'error' | 'cancelled';
  progress: number;
  message: string;
  result?: SoundDesignResult;
  error?: string;
}

export interface Job {
  id: string;
  status: 'running' | 'complete' | 'error' | 'cancelled';
  videoPath: string;
  createdAt: number;
  events: SSEEvent[];
  result?: SoundDesignResult;
  abortController?: AbortController;
}

export interface SSEEvent {
  id: string;
  data: JobProgress;
}
