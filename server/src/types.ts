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

// ─── Pass 1.5: Action Spotting ───

export interface SpottedAction {
  startTime: number;
  endTime: number;
  action: string;    // what's happening visually
  sound: string;     // what it sounds like (ElevenLabs prompt)
  loop: boolean;     // true = rhythmic/continuous (loop clip), false = one-shot event
}

export interface ActionSpotting {
  actions: SpottedAction[];
}

// ─── Pass 1.75: Global Sonic Context ───

export interface GlobalSonicContext {
  environment_type: string;    // e.g. "interior", "exterior", "mixed", "abstract"
  primary_location: string;    // e.g. "urban apartment", "forest trail", "concert hall"
  scale: string;               // e.g. "intimate", "medium", "grand", "epic"
  realism_style: string;       // e.g. "hyperrealistic", "naturalistic", "stylized", "abstract"
  acoustic_character: string;  // e.g. "dry and close", "reverberant hall", "open air"
  energy_profile: string;      // e.g. "calm throughout", "builds from still to explosive"
  perspective: string;         // e.g. "close-mic first person", "distant observer", "shifting"
  era: string;                 // e.g. "contemporary", "1970s", "futuristic", "timeless"
}

// ─── Pass 2: Sound Design Plan ───

export type MusicMixLevel = 'off' | 'low' | 'medium' | 'high';
export type LoudnessClass = 'quiet' | 'moderate' | 'loud';

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

export interface AmbientSegment {
  startTime: number;
  endTime: number;
  prompt: string;
  loudness_class: LoudnessClass;
  loop: boolean;
}

export interface SoundDesignPlan {
  scenes: SoundDesignScene[];
  music_segments: MusicSegment[];
  ambient_segments: AmbientSegment[];
  full_video_music_prompt: string;
  global_music_style: string;
}

// ─── Pass 3: Dialogue Plan ───

export type SpeakerGender = 'male' | 'female' | 'neutral';

export interface SpeakerMeta {
  label: string;           // e.g. "speaker_1", "narrator"
  name: string;            // e.g. "Detective Morris", "Narrator"
  gender: SpeakerGender;
  vocalQuality: string;    // e.g. "deep and authoritative", "warm and gentle"
  voiceId?: string;        // assigned ElevenLabs voice ID
}

export interface DialogueLine {
  startTime: number;       // seconds
  endTime: number;
  speakerLabel: string;    // matches SpeakerMeta.label
  text: string;
  emotion: string;         // neutral, calm, excited, angry, sad, whispering
  voiceId?: string;        // resolved from SpeakerMeta
}

export interface DialoguePlan {
  speakers: SpeakerMeta[];
  lines: DialogueLine[];
}

// ─── Generated Output ───

export interface GeneratedTrack {
  id: string;
  type: 'music' | 'ambient' | 'sfx' | 'dialogue';
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
  prompt?: string;
  originalPrompt?: string;
  speakerLabel?: string;
  text?: string;
  emotion?: string;
}

/** Exact params sent to ElevenLabs for an SFX call (for audit in 10_generation_results.json). */
export interface SfxApiSent {
  text: string;
  durationSeconds: number;
  promptInfluence: number;
  loop: boolean;
}

export interface TrackGenerationResult {
  planned: {
    type: 'music' | 'ambient' | 'sfx' | 'dialogue';
    prompt: string;
    originalPrompt?: string;
    startTimeSec: number;
    durationSec: number;
  };
  status: 'success' | 'fallback' | 'failed';
  track?: GeneratedTrack;
  error?: string;
  fallbackPrompt?: string;
  retryCount: number;
  /** For SFX: exact params sent to the ElevenLabs API. */
  apiSent?: SfxApiSent;
}

export interface GenerationStats {
  planned: number;
  succeeded: number;
  fallback: number;
  failed: number;
}

export interface GenerationReport {
  music: { results: TrackGenerationResult[]; stats: GenerationStats };
  ambient: { results: TrackGenerationResult[]; stats: GenerationStats };
  sfx: { results: TrackGenerationResult[]; stats: GenerationStats };
  dialogue?: { results: TrackGenerationResult[]; stats: GenerationStats };
}

export interface SoundDesignResult {
  storyAnalysis: StoryAnalysis;
  globalSonicContext?: GlobalSonicContext;
  soundDesignPlan: SoundDesignPlan;
  dialoguePlan?: DialoguePlan;
  tracks: GeneratedTrack[];
  generationReport?: GenerationReport;
}

export interface JobProgress {
  stage: 'uploading' | 'uploading_to_gemini' | 'analyzing_story' | 'analyzing_sonic_context' | 'analyzing_sound_design' | 'planning_dialogue' | 'optimizing_prompts' | 'generating' | 'generating_dialogue' | 'complete' | 'error' | 'cancelled';
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
