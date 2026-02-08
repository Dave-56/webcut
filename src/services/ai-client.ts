// Types mirrored from server/src/types.ts to avoid cross-project imports

// ─── Pass 1: Story Analysis ───

export interface StoryBeat {
  startTime: number;
  endTime: number;
  description: string;
  emotion: string;
  significance: 'major' | 'minor' | 'transition';
  environment: string;
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
  dialogue: number;
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

export interface AnalyzeResponse {
  jobId: string;
}

const API_BASE = '/api';

/**
 * Upload a video file for AI sound design analysis.
 */
export async function analyzeVideo(
  file: File,
  targetLanguage?: string,
): Promise<AnalyzeResponse> {
  const formData = new FormData();
  formData.append('video', file);
  if (targetLanguage) {
    formData.append('targetLanguage', targetLanguage);
  }

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
