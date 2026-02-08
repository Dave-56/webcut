// ─── Pass 1: Story Analysis ───

export interface StoryBeat {
  startTime: number;      // seconds
  endTime: number;
  description: string;    // rich, evocative description
  emotion: string;        // emotional tone of this beat
  significance: 'major' | 'minor' | 'transition';
  environment: string;    // physical setting/location
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

export type SfxCategory = 'hard' | 'soft';

export interface MixHierarchy {
  dialogue: number;   // 0–1
  music: number;
  sfx: number;
}

export interface SoundDesignScene {
  startTime: number;
  endTime: number;
  description: string;
  mixHierarchy: MixHierarchy;
}

export interface PlannedSfx {
  time: number;
  duration: number;
  description: string;
  category: SfxCategory;
}

export interface PlannedMusic {
  startTime: number;
  endTime: number;
  prompt: string;
  genre: string;
  style: string;
  loop: boolean;
}

export interface SoundDesignPlan {
  scenes: SoundDesignScene[];
  sfx: PlannedSfx[];
  music: PlannedMusic[];
}

// ─── Generated Output ───

export interface GeneratedTrack {
  id: string;
  type: 'music' | 'sfx' | 'dialogue';
  filePath: string;
  startTimeSec: number;
  actualDurationSec: number;
  requestedDurationSec: number;
  loop: boolean;
  label: string;
  volume: number;
  sfxCategory?: SfxCategory;
}

export interface SoundDesignResult {
  storyAnalysis: StoryAnalysis;
  soundDesignPlan: SoundDesignPlan;
  tracks: GeneratedTrack[];
}

export interface JobProgress {
  stage: 'uploading' | 'extracting' | 'analyzing_story' | 'analyzing_sound_design' | 'generating' | 'dubbing' | 'complete' | 'error' | 'cancelled';
  progress: number;
  message: string;
  result?: SoundDesignResult;
  error?: string;
}

export interface Job {
  id: string;
  status: 'running' | 'complete' | 'error' | 'cancelled';
  videoPath: string;
  targetLanguage?: string;
  createdAt: number;
  events: SSEEvent[];
  result?: SoundDesignResult;
  abortController?: AbortController;
}

export interface SSEEvent {
  id: string;
  data: JobProgress;
}
