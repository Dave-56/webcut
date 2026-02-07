import { ref, type Ref } from 'vue';
import { createRandomString } from 'ts-fns';
import { useWebCutContext, useWebCutPlayer } from './index';
import {
  analyzeVideo,
  listenToJobStatus,
  downloadAudioTrack,
  cancelJob as cancelJobApi,
  type JobProgress,
  type SoundDesignResult,
  type GeneratedTrack,
} from '../services/ai-client';

export interface AiPipelineState {
  /** Whether the pipeline is currently processing */
  isProcessing: Ref<boolean>;
  /** Current progress (0 to 1) */
  progress: Ref<number>;
  /** Current stage label */
  stage: Ref<string>;
  /** Status message */
  message: Ref<string>;
  /** All progress events */
  events: Ref<JobProgress[]>;
  /** Current job ID */
  jobId: Ref<string | null>;
  /** Error message if pipeline failed */
  error: Ref<string | null>;
  /** Final result */
  result: Ref<SoundDesignResult | null>;
  /** Whether video has been loaded */
  videoLoaded: Ref<boolean>;
}

export function useAiPipeline() {
  const { push, remove } = useWebCutPlayer();
  const context = useWebCutContext();
  const { rails, sources } = context;

  // Pipeline state
  const isProcessing = ref(false);
  const progress = ref(0);
  const stage = ref('');
  const message = ref('');
  const events = ref<JobProgress[]>([]);
  const jobId = ref<string | null>(null);
  const error = ref<string | null>(null);
  const result = ref<SoundDesignResult | null>(null);
  const videoLoaded = ref(false);

  // Rail IDs for the four audio track types
  let musicRailId = '';
  let sfxRailId = '';
  let ambienceRailId = '';
  let dialogueRailId = '';

  // SSE cleanup function
  let closeSSE: (() => void) | null = null;

  /**
   * Pre-create empty rails so withRailId always finds them.
   */
  function createAudioRails() {
    musicRailId = createRandomString(16);
    sfxRailId = createRandomString(16);
    ambienceRailId = createRandomString(16);
    dialogueRailId = createRandomString(16);

    rails.value.push(
      { id: musicRailId, type: 'audio', segments: [], transitions: [] },
      { id: sfxRailId, type: 'audio', segments: [], transitions: [] },
      { id: ambienceRailId, type: 'audio', segments: [], transitions: [] },
      { id: dialogueRailId, type: 'audio', segments: [], transitions: [] },
    );
  }

  /**
   * Clear all sources from the timeline (except video).
   */
  function clearAudioSources() {
    for (const [id, source] of sources.value) {
      if (source.type === 'audio') {
        remove(id);
      }
    }
    // Remove audio rails
    rails.value = rails.value.filter(r => r.type !== 'audio');
  }

  /**
   * Download an audio track and push it to the timeline.
   */
  async function downloadAndPushAudio(
    currentJobId: string,
    track: GeneratedTrack,
    railId: string,
    volume: number,
  ) {
    const blob = await downloadAudioTrack(currentJobId, track.id);
    const ext = track.filePath?.endsWith('.wav') ? '.wav' : '.mp3';
    const filename = `${track.type}_${track.id}${ext}`;
    const file = new File([blob], filename, { type: ext === '.wav' ? 'audio/wav' : 'audio/mpeg' });

    const startUs = track.startTimeSec * 1e6;
    const durationUs = track.actualDurationSec * 1e6;

    await push('audio', file, {
      audio: { volume },
      time: { start: startUs, duration: durationUs },
      withRailId: railId,
    });
  }

  /**
   * Populate the timeline with generated tracks.
   */
  async function populateTimeline(designResult: SoundDesignResult, currentJobId: string, targetLanguage?: string) {
    // Clear any existing audio
    clearAudioSources();

    // Create fresh rails
    createAudioRails();

    // Download and push each track in parallel per type
    const pushPromises: Promise<void>[] = [];

    for (const track of designResult.tracks) {
      let railId: string;
      let volume: number;

      switch (track.type) {
        case 'music':
          railId = musicRailId;
          volume = 0.3;
          break;
        case 'sfx':
          railId = sfxRailId;
          volume = 0.9;
          break;
        case 'ambience':
          railId = ambienceRailId;
          volume = 0.25;
          break;
        case 'dialogue':
          railId = dialogueRailId;
          volume = 1.0;
          break;
        default:
          continue;
      }

      pushPromises.push(
        downloadAndPushAudio(currentJobId, track, railId, volume).catch((err) => {
          console.error(`Failed to push track ${track.id}:`, err);
        }),
      );
    }

    await Promise.all(pushPromises);

    // If dubbing is active, reduce original video volume
    if (targetLanguage) {
      await muteOriginalVideo();
    }
  }

  /**
   * Reduce the original video audio to near-silent for dubbing.
   */
  async function muteOriginalVideo() {
    for (const [id, source] of sources.value) {
      if (source.type === 'video') {
        // Look up timing from the rail/segment
        const rail = rails.value.find(r => r.id === source.railId);
        const segment = rail?.segments.find(s => s.id === source.segmentId);
        const startTime = segment?.start ?? 0;
        const duration = segment ? segment.end - segment.start : undefined;
        const videoFileId = source.fileId;
        if (!videoFileId) break;

        await remove(id);
        await push('video', `file:${videoFileId}`, {
          video: { volume: 0.05 },
          time: { start: startTime, duration },
          autoFitRect: 'contain',
        });
        break; // only one video expected
      }
    }
  }

  /**
   * Start the AI sound design pipeline.
   */
  async function startPipeline(file: File, targetLanguage?: string) {
    // Reset state
    isProcessing.value = true;
    progress.value = 0;
    stage.value = 'uploading';
    message.value = 'Uploading video...';
    events.value = [];
    error.value = null;
    result.value = null;

    try {
      // 1. Push video to WebCut player immediately (local playback)
      await push('video', file, { autoFitRect: 'contain' });
      videoLoaded.value = true;

      // 2. Upload to backend for AI analysis
      const { jobId: id } = await analyzeVideo(file, targetLanguage);
      jobId.value = id;

      // 3. Listen for progress via SSE
      await new Promise<void>((resolve, reject) => {
        closeSSE = listenToJobStatus(
          id,
          (prog) => {
            events.value.push(prog);
            progress.value = prog.progress;
            stage.value = prog.stage;
            message.value = prog.message;

            if (prog.stage === 'complete' && prog.result) {
              result.value = prog.result;
              resolve();
            } else if (prog.stage === 'error') {
              reject(new Error(prog.error || prog.message));
            } else if (prog.stage === 'cancelled') {
              reject(new Error('Pipeline cancelled'));
            }
          },
          (err) => {
            reject(err);
          },
        );
      });

      // 4. Populate timeline with results
      if (result.value) {
        stage.value = 'populating';
        message.value = 'Adding audio tracks to timeline...';
        await populateTimeline(result.value, id, targetLanguage);
        message.value = `Done! Added ${result.value.tracks.length} audio tracks.`;
      }
    } catch (err: any) {
      error.value = err.message;
      stage.value = 'error';
      message.value = err.message;
    } finally {
      isProcessing.value = false;
      closeSSE?.();
      closeSSE = null;
    }
  }

  /**
   * Cancel the current pipeline.
   */
  async function cancel() {
    if (jobId.value) {
      try {
        await cancelJobApi(jobId.value);
      } catch {
        // best effort
      }
    }
    closeSSE?.();
    closeSSE = null;
    isProcessing.value = false;
    stage.value = 'cancelled';
    message.value = 'Pipeline cancelled';
  }

  const state: AiPipelineState = {
    isProcessing,
    progress,
    stage,
    message,
    events,
    jobId,
    error,
    result,
    videoLoaded,
  };

  return {
    ...state,
    startPipeline,
    cancel,
  };
}
