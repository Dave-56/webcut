export interface SceneAnalysis {
  scenes: Scene[];
  speechSegments: SpeechSegment[];
  soundEffects: SoundEffect[];
  overallMood: string;
}

export interface Scene {
  startTime: number;    // seconds
  endTime: number;
  description: string;
  mood: string;
  suggestedAmbience: string;
}

export interface SpeechSegment {
  startTime: number;
  endTime: number;
  text: string;
  language: string;
  speakerLabel: string;
}

export interface SoundEffect {
  time: number;         // seconds
  duration: number;
  description: string;
}

export interface GeneratedTrack {
  id: string;
  type: 'music' | 'sfx' | 'ambience' | 'dialogue';
  filePath: string;
  startTimeSec: number;
  actualDurationSec: number;
  requestedDurationSec: number;
  loop: boolean;
  label: string;
}

export interface SoundDesignResult {
  analysis: SceneAnalysis;
  tracks: GeneratedTrack[];
}

export interface JobProgress {
  stage: 'uploading' | 'extracting' | 'analyzing' | 'generating' | 'dubbing' | 'complete' | 'error' | 'cancelled';
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
