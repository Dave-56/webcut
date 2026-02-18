import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { createRandomString } from 'ts-fns';
import { throttle } from 'ts-fns';
import { useWebCutContext, useWebCutPlayer } from './index';
import {
  analyzeVideo,
  listenToJobStatus,
  downloadAudioTrack,
  cancelJob as cancelJobApi,
  regenerateSfx,
  regenerateDialogue,
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
  const { push, remove, syncSourceMeta, syncSourceTickInterceptor } = useWebCutPlayer();
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

  // Track-to-source mapping for quick-edit operations
  const trackSourceMap = ref(new Map<string, string>());
  const regeneratingTrackId = ref<string | null>(null);
  const extendingTrackId = ref<string | null>(null);
  // Original requestedDurationSec per track — extend multipliers always use this as base
  const trackBaseDurations = ref(new Map<string, number>());

  // Selected AI track — driven by timeline segment selection
  const selectedAiTrack = computed<GeneratedTrack | null>(() => {
    if (!result.value) return null;
    const source = context.currentSource.value;
    if (!source) return null;
    for (const [trackId, sourceKey] of trackSourceMap.value) {
      if (sourceKey === source.key) {
        return result.value.tracks.find(t => t.id === trackId) ?? null;
      }
    }
    return null;
  });

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
  let ambientRailId = '';
  let sfxRailId = '';
  let dialogueRailIds: string[] = [];
  const dialogueTrackRailMap = ref(new Map<string, string>());
  const dialogueSpeakerRailMap = ref(new Map<string, string>());

  // SSE cleanup function
  let closeSSE: (() => void) | null = null;

  /**
   * Pre-create empty rails so withRailId always finds them.
   * Rails: music (always), ambient (optional), SFX (optional), dialogue x2 (optional).
   */
  function createAudioRails(hasAmbient: boolean, hasSfx: boolean, hasDialogue: boolean) {
    musicRailId = createRandomString(16);
    rails.value.push(
      { id: musicRailId, type: 'audio', segments: [], transitions: [] },
    );

    if (hasAmbient) {
      ambientRailId = createRandomString(16);
      rails.value.push(
        { id: ambientRailId, type: 'audio', segments: [], transitions: [] },
      );
    }

    if (hasSfx) {
      sfxRailId = createRandomString(16);
      rails.value.push(
        { id: sfxRailId, type: 'audio', segments: [], transitions: [] },
      );
    }

    if (hasDialogue) {
      dialogueRailIds = [createRandomString(16), createRandomString(16)];
      rails.value.push(
        { id: dialogueRailIds[0], type: 'audio', segments: [], transitions: [] },
        { id: dialogueRailIds[1], type: 'audio', segments: [], transitions: [] },
      );
    } else {
      dialogueRailIds = [];
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
    trackSourceMap.value.clear();
    trackBaseDurations.value.clear();
    dialogueTrackRailMap.value.clear();
    dialogueSpeakerRailMap.value.clear();
  }

  function toUs(sec: number): number {
    return Math.round(sec * 1e6);
  }

  function chooseDialogueRail(track: GeneratedTrack, preferredRailId?: string): string {
    if (dialogueRailIds.length < 2) {
      return dialogueRailIds[0] ?? '';
    }

    const startUs = toUs(track.startTimeSec);
    const endUs = startUs + toUs(track.requestedDurationSec);
    const firstRailId = dialogueRailIds[0];
    const secondRailId = dialogueRailIds[1];
    const fallbackPreferred = preferredRailId && dialogueRailIds.includes(preferredRailId)
      ? preferredRailId
      : firstRailId;
    const alternateRailId = fallbackPreferred === firstRailId ? secondRailId : firstRailId;

    const hasOverlap = (railId: string) => {
      const rail = rails.value.find(r => r.id === railId);
      if (!rail) return false;
      return rail.segments.some(segment => !(endUs <= segment.start || startUs >= segment.end));
    };

    if (!hasOverlap(fallbackPreferred)) return fallbackPreferred;
    if (!hasOverlap(alternateRailId)) return alternateRailId;

    const latestEndUs = (railId: string) => {
      const rail = rails.value.find(r => r.id === railId);
      if (!rail || rail.segments.length === 0) return 0;
      return Math.max(...rail.segments.map(s => s.end));
    };

    return latestEndUs(firstRailId) <= latestEndUs(secondRailId) ? firstRailId : secondRailId;
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

    const targetVolume = track.volume;
    // Pass volume=1 to AudioClip so samples aren't pre-scaled;
    // real volume is applied at runtime via tick interceptor
    const audioOpts: Record<string, any> = { volume: 1, loop: track.loop };
    if (track.type === 'music') {
      // Scale fades proportionally: 15% of duration, min 0.5s, max 3s
      const durationSec = track.requestedDurationSec;
      const fadeSec = Math.max(0.5, Math.min(3, durationSec * 0.15));
      audioOpts.fadeIn = fadeSec * 1e6;
      audioOpts.fadeOut = fadeSec * 1e6;
    } else if (track.type === 'ambient') {
      // Ambient gets gentle fades: 15% of duration, 0.5–2s cap
      const durationSec = track.requestedDurationSec;
      const fadeSec = Math.max(0.5, Math.min(2, durationSec * 0.15));
      audioOpts.fadeIn = fadeSec * 1e6;
      audioOpts.fadeOut = fadeSec * 1e6;
    } else if (track.type === 'dialogue') {
      // No fades for dialogue — speech should start and end cleanly
    } else if (track.type === 'sfx' && track.requestedDurationSec > 5) {
      // Long SFX (>5s, continuous) get short fades
      const durationSec = track.requestedDurationSec;
      const fadeSec = Math.max(0.5, Math.min(2, durationSec * 0.15));
      audioOpts.fadeIn = fadeSec * 1e6;
      audioOpts.fadeOut = fadeSec * 1e6;
    }

    const sourceKey = await push('audio', file, {
      audio: audioOpts,
      time: { start: startUs, duration: durationUs },
      withRailId: railId,
    });
    trackSourceMap.value.set(track.id, sourceKey);

    // Install tick interceptor (handles volume, mute, fades at runtime)
    // and set the real volume — must happen after push() adds to sources map
    const source = sources.value.get(sourceKey);
    if (source) {
      syncSourceMeta(source, { audio: { volume: targetVolume } });
      syncSourceTickInterceptor(sourceKey);
    }

    // Store base duration only on first push (not on extend re-push)
    if (!trackBaseDurations.value.has(track.id)) {
      trackBaseDurations.value.set(track.id, track.requestedDurationSec);
    }
  }

  /**
   * Populate the timeline with generated tracks.
   */
  async function populateTimeline(designResult: SoundDesignResult, currentJobId: string) {
    // Clear any existing audio
    clearAudioSources();

    // Create fresh rails — add ambient/SFX/dialogue rails if tracks of those types exist
    const hasAmbient = designResult.tracks.some(t => t.type === 'ambient');
    const hasSfx = designResult.tracks.some(t => t.type === 'sfx');
    const hasDialogue = designResult.tracks.some(t => t.type === 'dialogue');
    createAudioRails(hasAmbient, hasSfx, hasDialogue);

    // Pre-assign dialogue tracks to one of two rails using simple overlap-aware packing.
    dialogueTrackRailMap.value.clear();
    dialogueSpeakerRailMap.value.clear();
    if (hasDialogue && dialogueRailIds.length === 2) {
      const speakerLaneIndexMap = new Map<string, number>();
      const dialogueTracks = designResult.tracks
        .filter(t => t.type === 'dialogue' && !t.skip)
        .sort((a, b) => a.startTimeSec - b.startTimeSec);

      for (const track of dialogueTracks) {
        const speakerKey = track.speakerLabel?.trim() || '__unknown_speaker__';
        if (!speakerLaneIndexMap.has(speakerKey)) {
          speakerLaneIndexMap.set(speakerKey, speakerLaneIndexMap.size % dialogueRailIds.length);
        }
        const preferredRailId = dialogueRailIds[speakerLaneIndexMap.get(speakerKey)!];
        dialogueSpeakerRailMap.value.set(speakerKey, preferredRailId);

        const assignedRailId = chooseDialogueRail(track, preferredRailId);
        dialogueTrackRailMap.value.set(track.id, assignedRailId);
      }
    }

    // Download and push each track in parallel
    const pushPromises: Promise<void>[] = [];

    for (const track of designResult.tracks) {
      // Skip silent segments — no audio to push
      if (track.skip) continue;

      let railId: string;
      if (track.type === 'ambient') railId = ambientRailId;
      else if (track.type === 'sfx') railId = sfxRailId;
      else if (track.type === 'dialogue') {
        railId = dialogueTrackRailMap.value.get(track.id) ?? dialogueRailIds[0];
      }
      else railId = musicRailId;

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
        const addedAmbient = finalResult.tracks.filter(t => t.type === 'ambient').length;
        const addedSfx = finalResult.tracks.filter(t => t.type === 'sfx').length;
        const addedDialogue = finalResult.tracks.filter(t => t.type === 'dialogue' && !t.skip).length;
        const msgParts: string[] = [`${addedMusic} music`];
        if (addedAmbient > 0) msgParts.push(`${addedAmbient} ambient`);
        if (addedSfx > 0) msgParts.push(`${addedSfx} SFX`);
        if (addedDialogue > 0) msgParts.push(`${addedDialogue} dialogue`);
        let msg = `Done! Added ${msgParts.join(' + ')} tracks.`;

        const report = finalResult.generationReport;
        if (report) {
          const totalFallback = report.sfx.stats.fallback + report.ambient.stats.fallback;
          const totalFailed = report.sfx.stats.failed + report.ambient.stats.failed;
          if (totalFallback > 0) msg += ` ${totalFallback} recovered via fallback.`;
          if (totalFailed > 0) msg += ` ${totalFailed} failed to generate.`;
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

  /**
   * Adjust playback speed of a track (pure frontend).
   */
  function adjustTrackSpeed(trackId: string, playbackRate: number) {
    const sourceKey = trackSourceMap.value.get(trackId);
    if (!sourceKey) return;
    const source = sources.value.get(sourceKey);
    if (!source) return;
    source.sprite.time.playbackRate = playbackRate;
  }

  /**
   * Adjust volume of a track at runtime via tick interceptor.
   */
  const throttledSyncTick = throttle(syncSourceTickInterceptor, 50);
  function adjustTrackVolume(trackId: string, volume: number) {
    const sourceKey = trackSourceMap.value.get(trackId);
    if (!sourceKey) return;
    const source = sources.value.get(sourceKey);
    if (!source) return;
    syncSourceMeta(source, { audio: { volume } });
    throttledSyncTick(sourceKey);
    // Keep track object in sync for UI fallback
    const track = result.value?.tracks.find(t => t.id === trackId);
    if (track) track.volume = volume;
  }

  /**
   * Shorten a track by truncating its segment end (pure frontend, no re-download).
   */
  function shortenTrack(trackId: string, newDurationSec: number) {
    const track = result.value?.tracks.find(t => t.id === trackId);
    if (!track) return;

    const sourceKey = trackSourceMap.value.get(trackId);
    if (!sourceKey) return;
    const source = sources.value.get(sourceKey);
    if (!source?.segmentId) return;

    const rail = rails.value.find(r => r.id === source.railId);
    if (!rail) return;
    const segment = rail.segments.find(s => s.id === source.segmentId);
    if (!segment) return;

    // Guard: minimum 0.5s
    const clampedSec = Math.max(newDurationSec, 0.5);
    const newDurationUs = clampedSec * 1e6;

    // Update segment and sprite
    segment.end = segment.start + newDurationUs;
    source.sprite.time.duration = newDurationUs;

    // Update track metadata to stay in sync
    track.requestedDurationSec = clampedSec;

    // Recalculate total timeline duration
    context.updateDuration();
  }

  /**
   * Extend a track by removing the old source and re-pushing with loop enabled
   * and the new duration. This is necessary because AudioClip's loop flag is
   * set at construction time and cannot be toggled after.
   */
  async function extendTrack(trackId: string, newDurationSec: number) {
    if (!result.value || !jobId.value) return;
    if (extendingTrackId.value) return; // Guard against concurrent calls

    const track = result.value.tracks.find(t => t.id === trackId);
    if (!track) return;

    extendingTrackId.value = trackId;

    // Capture old state for revert on failure
    const oldRequestedDuration = track.requestedDurationSec;
    const oldLoop = track.loop;

    // Capture current playbackRate and volume before removing the sprite
    const oldSourceKey = trackSourceMap.value.get(trackId);
    const oldSource = oldSourceKey ? sources.value.get(oldSourceKey) : null;
    const savedPlaybackRate = oldSource?.sprite.time.playbackRate ?? 1;
    const savedVolume = oldSource?.meta.audio?.volume ?? track.volume;

    // Update track metadata for re-push
    track.requestedDurationSec = newDurationSec;
    track.loop = true;
    track.volume = savedVolume;

    // Determine rail
    let railId: string;
    if (track.type === 'ambient') railId = ambientRailId;
    else if (track.type === 'sfx') railId = sfxRailId;
    else if (track.type === 'dialogue') {
      const sourceKey = trackSourceMap.value.get(trackId);
      const source = sourceKey ? sources.value.get(sourceKey) : null;
      railId = source?.railId ?? dialogueTrackRailMap.value.get(trackId) ?? dialogueRailIds[0];
    } else railId = musicRailId;

    // Remove old source from timeline
    if (oldSourceKey) {
      remove(oldSourceKey);
      trackSourceMap.value.delete(trackId);
      // Clean orphaned segment from rail (splice to keep same reactive array)
      const rail = rails.value.find(r => r.id === railId);
      if (rail) {
        const idx = rail.segments.findIndex(s => s.sourceKey === oldSourceKey);
        if (idx !== -1) rail.segments.splice(idx, 1);
      }
    }

    try {
      await downloadAndPushAudio(jobId.value, track, railId);

      // Restore playbackRate on new sprite
      const newSourceKey = trackSourceMap.value.get(trackId);
      if (newSourceKey) {
        const newSource = sources.value.get(newSourceKey);
        if (newSource) {
          if (savedPlaybackRate !== 1) {
            newSource.sprite.time.playbackRate = savedPlaybackRate;
          }
          if (newSource.segmentId) {
            context.selectSegment(newSource.segmentId, newSource.railId);
          }
        }
      }
    } catch {
      // Revert metadata — audio is gone but data model stays consistent
      track.requestedDurationSec = oldRequestedDuration;
      track.loop = oldLoop;
    } finally {
      extendingTrackId.value = null;
    }
  }

  /**
   * Select a track's segment on the timeline (enables bidirectional selection).
   */
  function selectTrackOnTimeline(trackId: string) {
    const sourceKey = trackSourceMap.value.get(trackId);
    if (!sourceKey) return;
    const source = sources.value.get(sourceKey);
    if (!source?.segmentId) return;
    context.selectSegment(source.segmentId, source.railId);
  }

  /**
   * Regenerate a single SFX/ambient track with a new prompt via the server.
   */
  async function regenerateTrack(trackId: string, newPrompt: string) {
    if (!result.value || !jobId.value) return;

    const track = result.value.tracks.find(t => t.id === trackId);
    if (!track || track.type === 'music' || track.type === 'dialogue') return;

    // Determine rail early so we can clean segments after remove
    let railId: string;
    if (track.type === 'ambient') railId = ambientRailId;
    else railId = sfxRailId;

    regeneratingTrackId.value = trackId;
    try {
      const { actualDurationSec, loop } = await regenerateSfx({
        jobId: jobId.value,
        trackId,
        prompt: newPrompt,
        durationSec: track.requestedDurationSec,
      });

      // Capture current playbackRate and volume before removing the sprite
      const oldSourceKey = trackSourceMap.value.get(trackId);
      const oldSource = oldSourceKey ? sources.value.get(oldSourceKey) : null;
      const savedPlaybackRate = oldSource?.sprite.time.playbackRate ?? 1;
      const savedVolume = oldSource?.meta.audio?.volume ?? track.volume;

      // Remove old source from timeline
      if (oldSourceKey) {
        remove(oldSourceKey);
        trackSourceMap.value.delete(trackId);
        // Clean orphaned segment from rail (splice to keep same reactive array)
        const rail = rails.value.find(r => r.id === railId);
        if (rail) {
          const idx = rail.segments.findIndex(s => s.sourceKey === oldSourceKey);
          if (idx !== -1) rail.segments.splice(idx, 1);
        }
      }

      // Update track object in result
      track.actualDurationSec = actualDurationSec;
      track.loop = loop;
      track.originalPrompt = newPrompt;
      track.prompt = newPrompt;
      track.label = `${track.type === 'sfx' ? 'SFX' : 'Ambient'}: ${newPrompt.slice(0, 50)}`;
      track.volume = savedVolume;

      await downloadAndPushAudio(jobId.value, track, railId);

      // Restore playbackRate on new sprite and re-select
      const newSourceKey = trackSourceMap.value.get(trackId);
      if (newSourceKey) {
        const newSource = sources.value.get(newSourceKey);
        if (newSource) {
          if (savedPlaybackRate !== 1) {
            newSource.sprite.time.playbackRate = savedPlaybackRate;
          }
          if (newSource.segmentId) {
            context.selectSegment(newSource.segmentId, newSource.railId);
          }
        }
      }
    } finally {
      regeneratingTrackId.value = null;
    }
  }

  /**
   * Regenerate a single dialogue track with new text/emotion via the server.
   */
  async function regenerateDialogueLine(
    trackId: string,
    newText: string,
    emotion?: string,
    voiceId?: string,
  ) {
    if (!result.value || !jobId.value) return;

    const track = result.value.tracks.find(t => t.id === trackId);
    if (!track || track.type !== 'dialogue') return;

    regeneratingTrackId.value = trackId;
    try {
      const { actualDurationSec, text } = await regenerateDialogue({
        jobId: jobId.value,
        trackId,
        text: newText,
        speakerLabel: track.speakerLabel,
        emotion,
        voiceId,
      });

      // Capture current state before removing
      const oldSourceKey = trackSourceMap.value.get(trackId);
      const oldSource = oldSourceKey ? sources.value.get(oldSourceKey) : null;
      const savedVolume = oldSource?.meta.audio?.volume ?? track.volume;

      // Remove old source from timeline
      const oldDialogueRailId = oldSource?.railId ?? dialogueTrackRailMap.value.get(trackId) ?? dialogueRailIds[0];
      if (oldSourceKey) {
        remove(oldSourceKey);
        trackSourceMap.value.delete(trackId);
        const rail = rails.value.find(r => r.id === oldDialogueRailId);
        if (rail) {
          const idx = rail.segments.findIndex(s => s.sourceKey === oldSourceKey);
          if (idx !== -1) rail.segments.splice(idx, 1);
        }
      }

      // Update track metadata
      track.actualDurationSec = actualDurationSec;
      track.requestedDurationSec = actualDurationSec;
      track.text = text;
      if (emotion) track.emotion = emotion;
      track.label = `${track.speakerLabel ?? 'Speaker'}: ${text.slice(0, 40)}`;
      track.volume = savedVolume;

      const speakerKey = track.speakerLabel?.trim() || '__unknown_speaker__';
      const preferredRailId =
        dialogueTrackRailMap.value.get(track.id) ||
        dialogueSpeakerRailMap.value.get(speakerKey) ||
        oldDialogueRailId;
      const targetDialogueRailId = chooseDialogueRail(track, preferredRailId);
      dialogueSpeakerRailMap.value.set(speakerKey, targetDialogueRailId);
      dialogueTrackRailMap.value.set(track.id, targetDialogueRailId);
      await downloadAndPushAudio(jobId.value, track, targetDialogueRailId);

      // Re-select on timeline
      const newSourceKey = trackSourceMap.value.get(trackId);
      if (newSourceKey) {
        const newSource = sources.value.get(newSourceKey);
        if (newSource?.segmentId) {
          context.selectSegment(newSource.segmentId, newSource.railId);
        }
      }
    } finally {
      regeneratingTrackId.value = null;
    }
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
    regeneratingTrackId,
    extendingTrackId,
    trackBaseDurations,
    selectedAiTrack,
    loadVideo,
    startAnalysis,
    resetToIntent,
    cancel,
    adjustTrackSpeed,
    adjustTrackVolume,
    trackSourceMap,
    shortenTrack,
    extendTrack,
    selectTrackOnTimeline,
    regenerateTrack,
    regenerateDialogueLine,
  };
}
