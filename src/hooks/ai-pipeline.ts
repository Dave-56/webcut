import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { createRandomString } from 'ts-fns';
import { useWebCutContext, useWebCutPlayer } from './index';
import {
  analyzeVideo,
  listenToJobStatus,
  downloadAudioTrack,
  cancelJob as cancelJobApi,
  type AnalysisOptions,
  type JobProgress,
  type SoundDesignResult,
  type GeneratedTrack,
} from '../services/ai-client';
import { measureVideoSize, measureVideoDuration } from '../libs';

export type AiPhase = 'upload' | 'intent' | 'processing' | 'complete' | 'error';

export interface VideoMeta {
  filename: string;
  durationSec: number;
  width: number;
  height: number;
  fileSizeMB: number;
}

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
  /** Current phase of the pipeline */
  phase: ComputedRef<AiPhase>;
  /** Video metadata extracted after load */
  videoMeta: Ref<VideoMeta | null>;
  /** Last analysis options used */
  lastOptions: Ref<AnalysisOptions>;
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

  // New state
  const videoFile = ref<File | null>(null);
  const videoMeta = ref<VideoMeta | null>(null);
  const lastOptions = ref<AnalysisOptions>({});
  let cancelledByUser = false; // Not reactive — internal flag only

  // Computed phase
  const phase = computed<AiPhase>(() => {
    if (!videoLoaded.value && !stage.value) return 'upload';
    if (videoLoaded.value && !isProcessing.value && !result.value && !error.value) return 'intent';
    if (isProcessing.value) return 'processing';
    if (result.value) return 'complete';
    if (error.value) return 'error';
    return 'upload';
  });

  // Rail IDs for audio tracks
  let musicRailId = '';
  let sfxRailId = '';

  // SSE cleanup function
  let closeSSE: (() => void) | null = null;

  /**
   * Pre-create empty rails so withRailId always finds them.
   */
  function createAudioRails(hasSfx: boolean) {
    musicRailId = createRandomString(16);
    rails.value.push(
      { id: musicRailId, type: 'audio', segments: [], transitions: [] },
    );

    if (hasSfx) {
      sfxRailId = createRandomString(16);
      rails.value.push(
        { id: sfxRailId, type: 'audio', segments: [], transitions: [] },
      );
    }
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
   * Uses track.volume from mix hierarchy and supports loop via requestedDurationSec.
   */
  async function downloadAndPushAudio(
    currentJobId: string,
    track: GeneratedTrack,
    railId: string,
  ) {
    const blob = await downloadAudioTrack(currentJobId, track.id);
    const ext = track.filePath?.endsWith('.wav') ? '.wav' : '.mp3';
    const filename = `${track.type}_${track.id}${ext}`;
    const file = new File([blob], filename, { type: ext === '.wav' ? 'audio/wav' : 'audio/mpeg' });

    const startUs = track.startTimeSec * 1e6;
    // Always use requestedDurationSec so the sprite clips to the planned segment span,
    // preventing music from overrunning the video end
    const durationUs = track.requestedDurationSec * 1e6;

    const audioOpts: Record<string, any> = { volume: track.volume, loop: track.loop };
    if (track.type === 'music') {
      // Scale fades proportionally: 15% of duration, min 0.5s, max 3s
      const durationSec = track.requestedDurationSec;
      const fadeSec = Math.max(0.5, Math.min(3, durationSec * 0.15));
      audioOpts.fadeIn = fadeSec * 1e6;
      audioOpts.fadeOut = fadeSec * 1e6;
    } else if (track.type === 'sfx' && track.category === 'ambient') {
      // Ambient SFX get short fades; hard/soft SFX remain unfaded
      const durationSec = track.requestedDurationSec;
      const fadeSec = Math.max(0.5, Math.min(2, durationSec * 0.15));
      audioOpts.fadeIn = fadeSec * 1e6;
      audioOpts.fadeOut = fadeSec * 1e6;
    }

    await push('audio', file, {
      audio: audioOpts,
      time: { start: startUs, duration: durationUs },
      withRailId: railId,
    });
  }

  /**
   * Populate the timeline with generated tracks.
   */
  async function populateTimeline(designResult: SoundDesignResult, currentJobId: string) {
    // Clear any existing audio
    clearAudioSources();

    // Create fresh rails — add SFX rail if there are SFX tracks
    const hasSfx = designResult.tracks.some(t => t.type === 'sfx');
    createAudioRails(hasSfx);

    // Download and push each track in parallel
    const pushPromises: Promise<void>[] = [];

    for (const track of designResult.tracks) {
      // Skip silent segments — no audio to push
      if (track.skip) continue;

      const railId = track.type === 'sfx' ? sfxRailId : musicRailId;
      pushPromises.push(
        downloadAndPushAudio(currentJobId, track, railId).catch((err) => {
          console.error(`Failed to push track ${track.id}:`, err);
        }),
      );
    }

    await Promise.all(pushPromises);
  }

  /**
   * Load a video file into the player and extract metadata.
   */
  async function loadVideo(file: File) {
    videoFile.value = file;
    await push('video', file, { autoFitRect: 'contain' });
    videoLoaded.value = true;

    const [size, duration] = await Promise.all([
      measureVideoSize(file),
      measureVideoDuration(file),
    ]);
    videoMeta.value = {
      filename: file.name,
      durationSec: duration,
      width: size.width,
      height: size.height,
      fileSizeMB: parseFloat((file.size / (1024 * 1024)).toFixed(1)),
    };
  }

  /**
   * Start the AI sound design analysis with options.
   */
  async function startAnalysis(options: AnalysisOptions = {}) {
    if (!videoFile.value) return;

    cancelledByUser = false;
    lastOptions.value = options;
    isProcessing.value = true;
    progress.value = 0;
    stage.value = 'uploading';
    message.value = 'Uploading video...';
    events.value = [];
    error.value = null;
    result.value = null;

    try {
      const { jobId: id } = await analyzeVideo(videoFile.value, options);
      jobId.value = id;

      // Listen for progress via SSE
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

      // Populate timeline with results
      const finalResult = result.value as SoundDesignResult | null;
      if (finalResult) {
        stage.value = 'populating';
        message.value = 'Adding audio tracks to timeline...';
        await populateTimeline(finalResult, jobId.value!);
        const addedMusic = finalResult.tracks.filter(t => t.type === 'music' && !t.skip).length;
        const addedSfx = finalResult.tracks.filter(t => t.type === 'sfx').length;
        let msg = addedSfx > 0
          ? `Done! Added ${addedMusic} music + ${addedSfx} SFX tracks.`
          : `Done! Added ${addedMusic} audio tracks.`;

        const report = finalResult.generationReport;
        if (report) {
          const sfxFallback = report.sfx.stats.fallback;
          const sfxFailed = report.sfx.stats.failed;
          if (sfxFallback > 0) msg += ` ${sfxFallback} SFX recovered via fallback.`;
          if (sfxFailed > 0) msg += ` ${sfxFailed} SFX failed to generate.`;
        }
        message.value = msg;
      }
    } catch (err: any) {
      if (cancelledByUser) {
        resetToIntent();
        return;
      }
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
    cancelledByUser = true;
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
    stage.value = '';
    message.value = '';
  }

  /**
   * Reset to intent phase — clears audio/results but keeps video loaded.
   */
  function resetToIntent() {
    clearAudioSources();
    result.value = null;
    error.value = null;
    stage.value = '';
    message.value = '';
    events.value = [];
    jobId.value = null;
  }

  return {
    isProcessing,
    progress,
    stage,
    message,
    events,
    jobId,
    error,
    result,
    videoLoaded,
    phase,
    videoMeta,
    lastOptions,
    loadVideo,
    startAnalysis,
    resetToIntent,
    cancel,
  };
}
