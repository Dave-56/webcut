// Types mirrored from server/src/types.ts to avoid cross-project imports

export interface SceneAnalysis {
  scenes: Array<{
    startTime: number;
    endTime: number;
    description: string;
    mood: string;
    suggestedAmbience: string;
  }>;
  speechSegments: Array<{
    startTime: number;
    endTime: number;
    text: string;
    language: string;
    speakerLabel: string;
  }>;
  soundEffects: Array<{
    time: number;
    duration: number;
    description: string;
  }>;
  overallMood: string;
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
