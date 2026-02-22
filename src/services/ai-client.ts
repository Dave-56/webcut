// Types mirrored from server/src/types.ts to avoid cross-project imports

// ─── Pass 1: Story Analysis ───

export interface StoryBeat {
  startTime: number;
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
  label: string;
  name: string;
  gender: SpeakerGender;
  vocalQuality: string;
  voiceId?: string;
}

export interface DialogueLine {
  startTime: number;
  endTime: number;
  speakerLabel: string;
  text: string;
  emotion: string;
  voiceId?: string;
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

export interface GenerationStats {
  planned: number;
  succeeded: number;
  fallback: number;
  failed: number;
}

export interface GenerationReport {
  music: { stats: GenerationStats };
  ambient: { stats: GenerationStats };
  sfx: { stats: GenerationStats };
  dialogue?: { stats: GenerationStats };
}

export interface SoundDesignResult {
  storyAnalysis: StoryAnalysis;
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

export type ContentType = 'youtube' | 'podcast' | 'short-form' | 'film' | 'commercial' | 'streaming';

export interface AnalysisOptions {
  creativeDirection?: string;
  userIntent?: string;
  useExistingAudio?: boolean;
  includeSfx?: boolean;
  contentType?: ContentType;
  includeDialogue?: boolean;
  dialogueScript?: string;
}

export interface AnalyzeResponse {
  jobId: string;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

/**
 * Upload a video file for AI sound design analysis.
 */
export async function analyzeVideo(
  file: File,
  options?: AnalysisOptions,
): Promise<AnalyzeResponse> {
  const formData = new FormData();
  formData.append('video', file);
  if (options?.creativeDirection) formData.append('creativeDirection', options.creativeDirection);
  if (options?.userIntent) formData.append('userIntent', options.userIntent);
  if (options?.useExistingAudio) formData.append('useExistingAudio', 'true');
  if (options?.includeSfx === false) formData.append('includeSfx', 'false');
  if (options?.contentType) formData.append('contentType', options.contentType);
  if (options?.includeDialogue) formData.append('includeDialogue', 'true');
  if (options?.dialogueScript) formData.append('dialogueScript', options.dialogueScript);

  const res = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    body: formData,
  });

  if (res.status === 409) {
    const data = await res.json();
    throw new Error(`A job is already in progress: ${data.activeJobId}`);
  }
  if (res.status === 413) {
    throw new Error('File too large. Maximum size is 500MB.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `Upload failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Listen to job progress via SSE. Calls onProgress for each event.
 * Returns a cleanup function to close the connection.
 */
export function listenToJobStatus(
  jobId: string,
  onProgress: (progress: JobProgress) => void,
  onError?: (error: Error) => void,
): () => void {
  const url = `${API_BASE}/status/${jobId}`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const progress: JobProgress = JSON.parse(event.data);
      onProgress(progress);

      // Close on terminal states
      if (progress.stage === 'complete' || progress.stage === 'error' || progress.stage === 'cancelled') {
        eventSource.close();
      }
    } catch (err) {
      console.error('Failed to parse SSE event:', err);
    }
  };

  eventSource.onerror = () => {
    // EventSource auto-reconnects on error, sending Last-Event-ID
    // Only call onError if the connection is permanently closed
    if (eventSource.readyState === EventSource.CLOSED) {
      onError?.(new Error('SSE connection closed'));
    }
  };

  return () => eventSource.close();
}

/**
 * Download a generated audio track as a Blob.
 */
export async function downloadAudioTrack(
  jobId: string,
  trackId: string,
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/audio/${jobId}/${trackId}`);
  if (!res.ok) {
    throw new Error(`Failed to download audio track: ${res.status}`);
  }
  return res.blob();
}

/**
 * Regenerate a single SFX or ambient track with a new prompt.
 */
export async function regenerateSfx(req: {
  jobId: string;
  trackId: string;
  prompt: string;
  durationSec: number;
}): Promise<{ trackId: string; actualDurationSec: number; loop: boolean }> {
  const res = await fetch(`${API_BASE}/regenerate-sfx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `Regeneration failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Regenerate a single dialogue track with new text/emotion.
 */
export async function regenerateDialogue(req: {
  jobId: string;
  trackId: string;
  text: string;
  speakerLabel?: string;
  emotion?: string;
  voiceId?: string;
}): Promise<{ trackId: string; actualDurationSec: number; text: string }> {
  const res = await fetch(`${API_BASE}/regenerate-dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `Dialogue regeneration failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Cancel a running job.
 */
export async function cancelJob(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/cancel/${jobId}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || 'Cancel failed');
  }
}
