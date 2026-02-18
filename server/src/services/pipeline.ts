import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { v4 as uuid } from 'uuid';
import { GeneratedTrack, SoundDesignResult, JobProgress, SoundDesignScene, MusicMixLevel, LoudnessClass, TrackGenerationResult, GenerationStats, GenerationReport, ActionSpotting, GlobalSonicContext, DialoguePlan, DialogueLine } from '../types.js';
import { uploadVideoFile, analyzeStory, createGlobalSonicContext, spotActions, createSoundDesignPlan, planDialogue, MODEL } from './gemini.js';
import { generateMusic, generateSoundEffectWithFallback, generateDubbedSpeech, assignVoices } from './elevenlabs.js';
import { normalizeAudio, LOUDNORM_TARGETS, TRUE_PEAK_DBTP, adjustAudioSpeed } from './video-utils.js';
import { rewritePrompts, type RewriteItem } from './prompt-rewriter.js';
import { addEvent } from './job-store.js';

interface PipelineConfig {
  jobId: string;
  videoPath: string;
  userIntent?: string;
  includeSfx?: boolean;
  includeDialogue?: boolean;
  dialogueScript?: string;
  contentType?: string;
  geminiApiKey: string;
  elevenLabsApiKey: string;
  signal?: AbortSignal;
}

/**
 * Post-hoc music volume multiplier per content type.
 * Applied on top of scene-based getVolumeForTrack() to enforce
 * content-type-appropriate music levels as a safety net.
 */
const CONTENT_TYPE_MUSIC_MULTIPLIER: Record<string, number> = {
  podcast: 0.6,
  streaming: 0.7,
  'short-form': 1.1,
};

function emit(jobId: string, progress: JobProgress): void {
  addEvent(jobId, progress);
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Aborted');
}

const MUSIC_LEVEL_TO_VOLUME: Record<MusicMixLevel, number> = {
  off: 0,
  low: 0.25,
  medium: 0.55,
  high: 0.85,
};

/**
 * Loudness-class volume lookup: base, dialogue, and high-music variants.
 */
const LOUDNESS_VOLUME: Record<LoudnessClass, { base: number; dialogue: number; highMusic: number }> = {
  quiet:    { base: 0.40, dialogue: 0.25, highMusic: 0.35 },
  moderate: { base: 0.55, dialogue: 0.35, highMusic: 0.45 },
  loud:     { base: 0.70, dialogue: 0.45, highMusic: 0.55 },
};

/**
 * Get volume for an ambient track using loudness class + scene context.
 */
function getAmbientVolume(startTimeSec: number, loudnessClass: LoudnessClass, scenes: SoundDesignScene[]): number {
  const scene = scenes.find(s => startTimeSec >= s.startTime && startTimeSec < s.endTime);
  const vol = LOUDNESS_VOLUME[loudnessClass] || LOUDNESS_VOLUME.moderate;
  if (scene?.dialogue) return vol.dialogue;
  if (scene?.music_level === 'high') return vol.highMusic;
  return vol.base;
}

/**
 * Assign SFX (Foley) volume based on scene context.
 * More aggressive ducking under dialogue+music, louder when mix is sparse.
 */
function getSfxVolume(startTimeSec: number, scenes: SoundDesignScene[]): number {
  const scene = scenes.find(s => startTimeSec >= s.startTime && startTimeSec < s.endTime);
  if (scene?.dialogue && scene?.music_level === 'high') return 0.3;
  if (scene?.dialogue) return 0.4;
  if (scene?.music_level === 'high') return 0.5;
  if (scene?.music_level === 'low' || scene?.music_level === 'off') return 0.8;
  return 0.65;
}

/**
 * Get volume for a music track based on the music_level
 * of the scene containing its start time.
 */
function getVolumeForTrack(
  startTimeSec: number,
  scenes: SoundDesignScene[],
): number {
  const scene = scenes.find(s => startTimeSec >= s.startTime && startTimeSec < s.endTime);
  const level = scene?.music_level ?? 'medium';
  return MUSIC_LEVEL_TO_VOLUME[level];
}

/** Dialogue is always priority in the mix. Flat volume. */
function getDialogueVolume(): number {
  return 0.90;
}

/**
 * Back-propagate dialogue flags to scenes after dialogue planning.
 * Sets scene.dialogue = true AND caps music_level to 'low' for scenes
 * that contain generated dialogue lines. This ensures ambient, SFX,
 * AND music all duck correctly during dialogue.
 */
function backPropagateDialogueFlags(scenes: SoundDesignScene[], lines: DialogueLine[]): void {
  for (const line of lines) {
    for (const scene of scenes) {
      if (line.startTime < scene.endTime && line.endTime > scene.startTime) {
        scene.dialogue = true;
        if (scene.music_level === 'medium' || scene.music_level === 'high') {
          scene.music_level = 'low';
        }
      }
    }
  }
}

export async function runPipeline(config: PipelineConfig): Promise<void> {
  const { jobId, videoPath, geminiApiKey, elevenLabsApiKey, signal } = config;
  const userIntent = config.userIntent?.slice(0, 500);

  const audioDir = path.resolve('data/jobs', jobId, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });

  try {
    // ─── Stage 1: Upload video to Gemini (0.00–0.15) ───
    emit(jobId, {
      stage: 'uploading_to_gemini',
      progress: 0.05,
      message: 'Uploading video to Gemini...',
    });

    checkAborted(signal);

    const videoFileRef = await uploadVideoFile(videoPath, geminiApiKey, signal);

    checkAborted(signal);

    emit(jobId, {
      stage: 'uploading_to_gemini',
      progress: 0.15,
      message: 'Video uploaded and processed by Gemini.',
    });

    // ─── Debug logging helper ───
    const jobDir = path.resolve('data/jobs', jobId);
    async function writeDebug(filename: string, content: string): Promise<void> {
      try {
        await fsp.writeFile(path.join(jobDir, filename), content, 'utf-8');
      } catch (err: any) {
        console.warn(`Failed to write debug file ${filename}:`, err.message);
      }
    }

    // Write metadata
    await writeDebug('0_meta.json', JSON.stringify({
      model: MODEL,
      timestamp: new Date().toISOString(),
      userIntent: userIntent ?? null,
      contentType: config.contentType ?? null,
    }, null, 2));

    // ─── Stage 2: Story Analysis — Pass 1 (0.15–0.30) ───
    emit(jobId, {
      stage: 'analyzing_story',
      progress: 0.15,
      message: 'Analyzing story...',
    });

    const storyResult = await analyzeStory(videoFileRef, geminiApiKey, signal, config.contentType, userIntent);
    const storyAnalysis = storyResult.data;

    checkAborted(signal);

    // Write Pass 1 debug files (non-blocking)
    writeDebug('1_prompt_story_analysis.txt', storyResult.promptSent);
    writeDebug('2_story_analysis_raw.txt', storyResult.rawResponse);
    writeDebug('3_story_analysis_parsed.json', JSON.stringify(storyAnalysis, null, 2));

    emit(jobId, {
      stage: 'analyzing_story',
      progress: 0.25,
      message: `Story analysis complete: ${storyAnalysis.beats.length} beats, genre: ${storyAnalysis.genre}`,
    });

    // ─── Stage 2.25: Global Sonic Context (0.25–0.31) ───
    emit(jobId, {
      stage: 'analyzing_sonic_context',
      progress: 0.25,
      message: 'Calibrating sonic world...',
    });

    const sonicContextResult = await createGlobalSonicContext(
      videoFileRef,
      storyAnalysis,
      geminiApiKey,
      signal,
      config.contentType,
      userIntent,
    );
    const globalSonicContext: GlobalSonicContext = sonicContextResult.data;

    checkAborted(signal);

    // Write sonic context debug files (non-blocking)
    writeDebug('3a_prompt_sonic_context.txt', sonicContextResult.promptSent);
    writeDebug('3b_sonic_context_raw.txt', sonicContextResult.rawResponse);
    writeDebug('3c_sonic_context_parsed.json', JSON.stringify(globalSonicContext, null, 2));

    emit(jobId, {
      stage: 'analyzing_sonic_context',
      progress: 0.31,
      message: `Sonic context: ${globalSonicContext.scale} ${globalSonicContext.realism_style}, ${globalSonicContext.environment_type}`,
    });

    // ─── Stage 2.5: Sound Design Plan — Pass 2 (0.31–0.37) ───
    emit(jobId, {
      stage: 'analyzing_sound_design',
      progress: 0.31,
      message: 'Planning sound design...',
    });

    const soundDesignResult = await createSoundDesignPlan(
      videoFileRef,
      storyAnalysis,
      storyAnalysis.durationSec,
      geminiApiKey,
      signal,
      config.contentType,
      userIntent,
      globalSonicContext,
    );
    const soundDesignPlan = soundDesignResult.data;

    checkAborted(signal);

    // Write Pass 2 debug files (non-blocking)
    writeDebug('4_prompt_sound_design.txt', soundDesignResult.promptSent);
    writeDebug('5_sound_design_raw.txt', soundDesignResult.rawResponse);
    writeDebug('6_sound_design_parsed.json', JSON.stringify(soundDesignPlan, null, 2));

    const ambientCount = soundDesignPlan.ambient_segments?.length ?? 0;
    emit(jobId, {
      stage: 'analyzing_sound_design',
      progress: 0.34,
      message: `Sound design plan: ${soundDesignPlan.music_segments.length} music + ${ambientCount} ambient segments, style: ${soundDesignPlan.global_music_style}`,
    });

    // ─── Stage 3: Action Spotting — Pass 2.5 (0.34–0.37) ───
    let actionSpotting: ActionSpotting = { actions: [] };
    if (config.includeSfx !== false) {
      emit(jobId, {
        stage: 'analyzing_sound_design',
        progress: 0.34,
        message: 'Spotting actions for sound effects...',
      });

      const actionSpottingResult = await spotActions(videoFileRef, storyAnalysis, geminiApiKey, signal, globalSonicContext);
      actionSpotting = actionSpottingResult.data;

      checkAborted(signal);

      writeDebug('7_prompt_action_spotting.txt', actionSpottingResult.promptSent);
      writeDebug('8_action_spotting_raw.txt', actionSpottingResult.rawResponse);
      writeDebug('9_action_spotting_parsed.json', JSON.stringify(actionSpotting, null, 2));

      const actionLog = actionSpotting.actions
        .map(a => `  ${a.startTime.toFixed(1)}s–${a.endTime.toFixed(1)}s  ${a.action}  →  "${a.sound}"`)
        .join('\n');
      writeDebug('9a_action_spotting_log.txt',
        `[Pass 2.5] Action Spotting — ${actionSpotting.actions.length} actions spotted:\n${actionLog}`);

      emit(jobId, {
        stage: 'analyzing_sound_design',
        progress: 0.37,
        message: `Spotted ${actionSpotting.actions.length} sound-producing actions`,
      });
    }

    // ─── Stage 3.25: Dialogue Planning (0.37–0.38) ───
    let dialoguePlan: DialoguePlan | undefined;
    if (config.includeDialogue) {
      emit(jobId, {
        stage: 'planning_dialogue',
        progress: 0.37,
        message: 'Planning dialogue lines...',
      });

      const dialogueResult = await planDialogue(
        videoFileRef,
        storyAnalysis,
        soundDesignPlan.scenes,
        geminiApiKey,
        signal,
        globalSonicContext,
        config.dialogueScript,
      );
      dialoguePlan = dialogueResult.data;

      // Assign voices to speakers (deterministic, gender-based)
      if (dialoguePlan.speakers.length > 0) {
        assignVoices(dialoguePlan.speakers);
        // Propagate voice IDs to lines
        for (const line of dialoguePlan.lines) {
          const speaker = dialoguePlan.speakers.find(s => s.label === line.speakerLabel);
          if (speaker?.voiceId) {
            line.voiceId = speaker.voiceId;
          }
        }
      }

      checkAborted(signal);

      writeDebug('9c_dialogue_plan.json', JSON.stringify(dialoguePlan, null, 2));

      emit(jobId, {
        stage: 'planning_dialogue',
        progress: 0.38,
        message: `Dialogue plan: ${dialoguePlan.lines.length} lines, ${dialoguePlan.speakers.length} speakers`,
      });

      // ─── Stage 3.3: Back-propagate dialogue flags + music_level ───
      if (dialoguePlan.lines.length > 0) {
        backPropagateDialogueFlags(soundDesignPlan.scenes, dialoguePlan.lines);
        writeDebug('9d_updated_scenes.json', JSON.stringify(soundDesignPlan.scenes, null, 2));
      }
    }

    // ─── Stage 3.5: Optimize prompts for ElevenLabs (0.37–0.39) ───
    const hasSfx = config.includeSfx !== false && actionSpotting.actions.length > 0;
    const hasAmbient = (soundDesignPlan.ambient_segments?.length ?? 0) > 0;
    const ambientSegments = soundDesignPlan.ambient_segments ?? [];
    const sfxSegments = hasSfx ? actionSpotting.actions : [];

    // Collect all SFX + ambient prompts for batch rewriting
    const rewriteItems: RewriteItem[] = [];
    const rewriteIndex: { kind: 'ambient' | 'sfx'; idx: number }[] = [];

    for (let i = 0; i < ambientSegments.length; i++) {
      const seg = ambientSegments[i];
      rewriteIndex.push({ kind: 'ambient', idx: i });
      rewriteItems.push({
        prompt: seg.prompt,
        type: 'ambient',
        loop: seg.loop,
        durationSec: seg.endTime - seg.startTime,
      });
    }
    for (let i = 0; i < sfxSegments.length; i++) {
      const seg = sfxSegments[i];
      rewriteIndex.push({ kind: 'sfx', idx: i });
      rewriteItems.push({
        prompt: seg.sound,
        type: 'sfx',
        loop: seg.loop,
        durationSec: seg.endTime - seg.startTime,
      });
    }

    // Maps from segment index → rewritten prompt (originals used as fallback)
    const rewrittenAmbientPrompts = new Map<number, string>();
    const rewrittenSfxPrompts = new Map<number, string>();

    if (rewriteItems.length > 0) {
      emit(jobId, {
        stage: 'optimizing_prompts',
        progress: 0.37,
        message: `Optimizing ${rewriteItems.length} audio prompts for generation...`,
      });

      checkAborted(signal);

      const rewritten = await rewritePrompts(rewriteItems, globalSonicContext, signal);

      checkAborted(signal);

      // Build debug trail and index maps
      const rewriteDebug: { type: string; original: string; rewritten: string; changed: boolean }[] = [];
      for (let i = 0; i < rewriteItems.length; i++) {
        const { kind, idx } = rewriteIndex[i];
        const original = rewriteItems[i].prompt;
        const optimized = rewritten[i];
        rewriteDebug.push({ type: kind, original, rewritten: optimized, changed: original !== optimized });
        if (kind === 'ambient') {
          rewrittenAmbientPrompts.set(idx, optimized);
        } else {
          rewrittenSfxPrompts.set(idx, optimized);
        }
      }

      writeDebug('9b_prompt_rewrites.json', JSON.stringify(rewriteDebug, null, 2));

      const changedCount = rewriteDebug.filter(d => d.changed).length;
      emit(jobId, {
        stage: 'optimizing_prompts',
        progress: 0.39,
        message: `Optimized ${changedCount}/${rewriteItems.length} prompts`,
      });
    }

    // ─── Stage 4: Generate music, ambient, and SFX (0.39–0.95) ───
    emit(jobId, {
      stage: 'generating',
      progress: 0.39,
      message: hasSfx || hasAmbient ? 'Generating music, ambient, and sound effects...' : 'Generating music...',
    });

    const tracks: GeneratedTrack[] = [];
    const generationPromises: Promise<void>[] = [];
    const musicResults: TrackGenerationResult[] = [];
    const ambientResults: TrackGenerationResult[] = [];
    const sfxResults: TrackGenerationResult[] = [];
    const dialogueResults: TrackGenerationResult[] = [];

    // Per-track progress tracking
    const sfxGenerationCount = sfxSegments.length;
    const ambientGenerationCount = ambientSegments.length;
    const multiSegmentMusicCount = soundDesignPlan.music_segments.filter(m => !m.skip).length;
    const dialogueGenerationCount = dialoguePlan?.lines.length ?? 0;
    let totalGenerations = multiSegmentMusicCount + ambientGenerationCount + sfxGenerationCount + dialogueGenerationCount;
    let completedGenerations = 0;

    function emitGenerationProgress() {
      completedGenerations++;
      const genProgress = 0.39 + (completedGenerations / totalGenerations) * 0.56;
      const failedCount = sfxResults.filter(r => r.status === 'failed').length + ambientResults.filter(r => r.status === 'failed').length;

      let msg = `Generating audio... (${completedGenerations}/${totalGenerations})`;
      if (failedCount > 0) {
        msg += ` — ${failedCount} failed`;
      }
      emit(jobId, { stage: 'generating', progress: Math.min(genProgress, 0.95), message: msg });
    }

    // ── Music generation — multi-segment ──
    {
      for (let i = 0; i < soundDesignPlan.music_segments.length; i++) {
        const planned = soundDesignPlan.music_segments[i];
        const trackId = uuid();
        const filePath = path.join(audioDir, `music_${trackId}.mp3`);
        const duration = planned.endTime - planned.startTime;

        if (planned.skip) {
          tracks.push({
            id: trackId,
            type: 'music',
            filePath: '',
            startTimeSec: planned.startTime,
            actualDurationSec: duration,
            requestedDurationSec: duration,
            loop: false,
            label: `Music (silent): ${planned.genre} — ${planned.prompt.slice(0, 40)}`,
            volume: 0,
            genre: planned.genre,
            style: planned.style,
            skip: true,
          });
          continue;
        }

        let enrichedPrompt = planned.prompt;
        // Only append global style if the segment prompt doesn't already mention it
        if (soundDesignPlan.global_music_style && !planned.prompt.toLowerCase().includes(soundDesignPlan.global_music_style.toLowerCase())) {
          enrichedPrompt += `. Style: ${soundDesignPlan.global_music_style}`;
        }

        const plannedInfo = { type: 'music' as const, prompt: enrichedPrompt, startTimeSec: planned.startTime, durationSec: duration };

        generationPromises.push(
          generateMusic(enrichedPrompt, duration, filePath, elevenLabsApiKey)
            .then(({ actualDurationSec, loop, retryCount }) => {
              const track: GeneratedTrack = {
                id: trackId,
                type: 'music',
                filePath,
                startTimeSec: planned.startTime,
                actualDurationSec,
                requestedDurationSec: duration,
                loop: planned.loop || loop,
                label: `Music: ${planned.genre} — ${planned.prompt.slice(0, 40)}`,
                volume: Math.min(1.0, getVolumeForTrack(planned.startTime, soundDesignPlan.scenes) * (CONTENT_TYPE_MUSIC_MULTIPLIER[config.contentType ?? ''] ?? 1.0)),
                genre: planned.genre,
                style: planned.style,
                prompt: enrichedPrompt,
              };
              tracks.push(track);
              musicResults.push({
                planned: plannedInfo,
                status: 'success',
                track, retryCount,
              });
              emitGenerationProgress();
            })
            .catch((err) => {
              console.error(`Failed to generate music:`, err.message);
              musicResults.push({
                planned: plannedInfo,
                status: 'failed',
                error: err.message, retryCount: 3,
              });
              emitGenerationProgress();
            }),
        );
      }
    }

    // ── Ambient generation ──
    if (hasAmbient) {
      for (let i = 0; i < ambientSegments.length; i++) {
        const planned = ambientSegments[i];
        const trackId = uuid();
        const filePath = path.join(audioDir, `ambient_${trackId}.mp3`);
        const duration = planned.endTime - planned.startTime;
        const optimizedPrompt = rewrittenAmbientPrompts.get(i) ?? planned.prompt;
        const plannedInfo = { type: 'ambient' as const, prompt: optimizedPrompt, originalPrompt: planned.prompt, startTimeSec: planned.startTime, durationSec: duration };

        generationPromises.push(
          generateSoundEffectWithFallback(optimizedPrompt, duration, filePath, elevenLabsApiKey, 0.3, planned.loop)
            .then(({ actualDurationSec, loop, retryCount, usedFallback, fallbackPrompt, error }) => {
              const track: GeneratedTrack = {
                id: trackId,
                type: 'ambient',
                filePath,
                startTimeSec: planned.startTime,
                actualDurationSec,
                requestedDurationSec: duration,
                loop: planned.loop || loop,
                label: `Ambient: ${planned.prompt.slice(0, 50)}`,
                volume: getAmbientVolume(planned.startTime, planned.loudness_class, soundDesignPlan.scenes),
                prompt: optimizedPrompt,
                originalPrompt: planned.prompt,
              };
              tracks.push(track);
              ambientResults.push({
                planned: plannedInfo,
                status: usedFallback ? 'fallback' : 'success',
                track, fallbackPrompt, error, retryCount,
              });
              emitGenerationProgress();
            })
            .catch((err) => {
              console.error(`Failed to generate ambient:`, err.message);
              ambientResults.push({
                planned: plannedInfo,
                status: 'failed',
                error: err.message, retryCount: 3,
              });
              emitGenerationProgress();
            }),
        );
      }
    }

    // ── SFX (Foley) generation ──
    if (hasSfx) {
      for (let i = 0; i < sfxSegments.length; i++) {
        const planned = sfxSegments[i];

        const trackId = uuid();
        const filePath = path.join(audioDir, `sfx_${trackId}.mp3`);
        const duration = planned.endTime - planned.startTime;
        const optimizedPrompt = rewrittenSfxPrompts.get(i) ?? planned.sound;
        const plannedInfo = { type: 'sfx' as const, prompt: optimizedPrompt, originalPrompt: planned.sound, startTimeSec: planned.startTime, durationSec: duration };

        const sfxPromptInfluence = 0.6;
        generationPromises.push(
          generateSoundEffectWithFallback(optimizedPrompt, duration, filePath, elevenLabsApiKey, sfxPromptInfluence, planned.loop)
            .then(({ actualDurationSec, loop: apiLoop, retryCount, usedFallback, fallbackPrompt, error, apiSent }) => {
              const track: GeneratedTrack = {
                id: trackId,
                type: 'sfx',
                filePath,
                startTimeSec: planned.startTime,
                actualDurationSec,
                requestedDurationSec: duration,
                loop: planned.loop || apiLoop,
                label: `SFX: ${planned.action.slice(0, 50)}`,
                volume: getSfxVolume(planned.startTime, soundDesignPlan.scenes),
                prompt: optimizedPrompt,
                originalPrompt: planned.sound,
              };
              tracks.push(track);
              sfxResults.push({
                planned: plannedInfo,
                status: usedFallback ? 'fallback' : 'success',
                track, fallbackPrompt, error, retryCount,
                apiSent,
              });
              emitGenerationProgress();
            })
            .catch((err) => {
              console.error(`Failed to generate SFX:`, err.message);
              sfxResults.push({
                planned: plannedInfo,
                status: 'failed',
                error: err.message, retryCount: 3,
              });
              emitGenerationProgress();
            }),
        );
      }
    }

    // ── Dialogue generation ──
    if (dialoguePlan && dialoguePlan.lines.length > 0) {
      for (const line of dialoguePlan.lines) {
        const trackId = uuid();
        const filePath = path.join(audioDir, `dialogue_${trackId}.mp3`);
        const duration = line.endTime - line.startTime;
        const speakerMeta = dialoguePlan.speakers.find(s => s.label === line.speakerLabel);
        const plannedInfo = {
          type: 'dialogue' as const,
          prompt: line.text,
          startTimeSec: line.startTime,
          durationSec: duration,
        };

        generationPromises.push(
          generateDubbedSpeech(
            line.text,
            'en',
            line.speakerLabel,
            duration,
            filePath,
            elevenLabsApiKey,
            line.emotion,
            line.voiceId,
          )
            .then(({ actualDurationSec, voiceId: usedVoiceId }) => {
              const track: GeneratedTrack = {
                id: trackId,
                type: 'dialogue',
                filePath,
                startTimeSec: line.startTime,
                actualDurationSec,
                requestedDurationSec: duration,
                loop: false,
                label: `${speakerMeta?.name ?? line.speakerLabel}: ${line.text.slice(0, 40)}`,
                volume: getDialogueVolume(),
                speakerLabel: line.speakerLabel,
                text: line.text,
                emotion: line.emotion,
              };
              tracks.push(track);
              dialogueResults.push({
                planned: plannedInfo,
                status: 'success',
                track,
                retryCount: 0,
              });
              emitGenerationProgress();
            })
            .catch((err) => {
              console.error(`Failed to generate dialogue for "${line.text.slice(0, 30)}":`, err.message);
              dialogueResults.push({
                planned: plannedInfo,
                status: 'failed',
                error: err.message,
                retryCount: 3,
              });
              emitGenerationProgress();
            }),
        );
      }
    }

    await Promise.all(generationPromises);

    checkAborted(signal);

    // ─── Stage 4.5a: Dialogue Timing Reconciliation ───
    const dialogueTracks = tracks
      .filter(t => t.type === 'dialogue' && t.filePath && !t.skip)
      .sort((a, b) => a.startTimeSec - b.startTimeSec);

    if (dialogueTracks.length > 0) {
      const reconciliationLog: string[] = [];

      for (let i = 0; i < dialogueTracks.length; i++) {
        const track = dialogueTracks[i];
        const requested = track.requestedDurationSec;
        const actual = track.actualDurationSec;
        const ratio = actual / requested;

        if (ratio <= 1.15 && ratio >= 0.85) {
          // Within 15%: accept, adjust end time
          track.requestedDurationSec = actual;
          reconciliationLog.push(`[ACCEPT] Track ${track.id}: ${actual.toFixed(2)}s vs ${requested.toFixed(2)}s (${((ratio - 1) * 100).toFixed(1)}%)`);
        } else if (ratio > 1.15 && ratio <= 1.30) {
          // 15-30% too long: speed up
          const speedFactor = Math.min(ratio, 1.15);
          try {
            await adjustAudioSpeed(track.filePath, speedFactor);
            const newDuration = actual / speedFactor;
            track.actualDurationSec = newDuration;
            track.requestedDurationSec = newDuration;
            reconciliationLog.push(`[SPEED] Track ${track.id}: sped up ${speedFactor.toFixed(2)}x (${actual.toFixed(2)}s → ~${newDuration.toFixed(2)}s)`);
          } catch (err: any) {
            track.requestedDurationSec = actual;
            reconciliationLog.push(`[SPEED-FAIL] Track ${track.id}: speed adjust failed (${err.message}), accepting actual duration`);
          }
        } else if (ratio < 0.85 && ratio >= 0.70) {
          // 15-30% too short: slow down
          const speedFactor = Math.max(ratio, 0.85);
          try {
            await adjustAudioSpeed(track.filePath, speedFactor);
            const newDuration = actual / speedFactor;
            track.actualDurationSec = newDuration;
            track.requestedDurationSec = newDuration;
            reconciliationLog.push(`[SPEED] Track ${track.id}: slowed ${speedFactor.toFixed(2)}x (${actual.toFixed(2)}s → ~${newDuration.toFixed(2)}s)`);
          } catch (err: any) {
            track.requestedDurationSec = actual;
            reconciliationLog.push(`[SPEED-FAIL] Track ${track.id}: speed adjust failed (${err.message}), accepting actual duration`);
          }
        } else {
          // >30% off: accept actual, shift subsequent if needed
          track.requestedDurationSec = actual;
          const overflow = actual - requested;
          reconciliationLog.push(`[SHIFT] Track ${track.id}: ${actual.toFixed(2)}s vs ${requested.toFixed(2)}s (${((ratio - 1) * 100).toFixed(1)}%), overflow=${overflow.toFixed(2)}s`);

          if (overflow > 0) {
            // Shift subsequent dialogue tracks forward
            for (let j = i + 1; j < dialogueTracks.length; j++) {
              const next = dialogueTracks[j];
              const newStart = next.startTimeSec + overflow;

              // Scene-boundary cap: if shifting pushes into a different scene, drop the track
              const originalScene = soundDesignPlan.scenes.find(s => next.startTimeSec >= s.startTime && next.startTimeSec < s.endTime);
              const newScene = soundDesignPlan.scenes.find(s => newStart >= s.startTime && newStart < s.endTime);
              if (originalScene && newScene && originalScene !== newScene) {
                next.skip = true;
                reconciliationLog.push(`[DROP] Track ${next.id}: shift would cross scene boundary, marking as failed`);
                continue;
              }

              next.startTimeSec = newStart;
              reconciliationLog.push(`[SHIFTED] Track ${next.id}: shifted forward by ${overflow.toFixed(2)}s to ${newStart.toFixed(2)}s`);
            }
          }
        }
      }

      // Final overlap check with 200ms minimum gap
      for (let i = 0; i < dialogueTracks.length - 1; i++) {
        const current = dialogueTracks[i];
        const next = dialogueTracks[i + 1];
        if (current.skip || next.skip) continue;

        const currentEnd = current.startTimeSec + current.requestedDurationSec;
        const gap = next.startTimeSec - currentEnd;
        if (gap < 0.2) {
          const shift = 0.2 - gap;
          const originalScene = soundDesignPlan.scenes.find(s => next.startTimeSec >= s.startTime && next.startTimeSec < s.endTime);
          const newStart = next.startTimeSec + shift;
          const newScene = soundDesignPlan.scenes.find(s => newStart >= s.startTime && newStart < s.endTime);
          if (originalScene && newScene && originalScene !== newScene) {
            next.skip = true;
            reconciliationLog.push(`[DROP-OVERLAP] Track ${next.id}: gap fix would cross scene boundary`);
          } else {
            next.startTimeSec = newStart;
            reconciliationLog.push(`[GAP] Track ${next.id}: shifted ${shift.toFixed(3)}s for 200ms minimum gap`);
          }
        }
      }

      writeDebug('9e_timing_reconciliation.json', JSON.stringify({
        log: reconciliationLog,
        tracks: dialogueTracks.map(t => ({
          id: t.id, startTimeSec: t.startTimeSec,
          actualDurationSec: t.actualDurationSec,
          requestedDurationSec: t.requestedDurationSec,
          skip: t.skip,
        })),
      }, null, 2));
    }

    // ─── Stage 4.5b: Normalize audio loudness (EBU R128) ───
    const tracksToNormalize = tracks.filter(t => t.filePath && !t.skip);
    if (tracksToNormalize.length > 0) {
      emit(jobId, {
        stage: 'generating',
        progress: 0.95,
        message: `Normalizing audio levels (${tracksToNormalize.length} tracks)...`,
      });

      let normalizeCount = 0;
      for (const track of tracksToNormalize) {
        checkAborted(signal);

        const lufsTarget = LOUDNORM_TARGETS[track.type] ?? LOUDNORM_TARGETS.sfx;
        const normalizedPath = track.filePath.replace(/(\.\w+)$/, '_norm$1');

        try {
          const result = await normalizeAudio(track.filePath, normalizedPath, lufsTarget, TRUE_PEAK_DBTP);
          // If normalizeAudio actually produced a new file, replace the original
          if (result !== track.filePath) {
            await fsp.rename(normalizedPath, track.filePath);
          }
          normalizeCount++;
        } catch (err: any) {
          // Non-fatal: log and keep the un-normalized file
          console.warn(`Loudness normalization failed for ${track.id} (${track.type}):`, err.message);
        }
      }

      writeDebug('10a_normalization.txt',
        `Normalized ${normalizeCount}/${tracksToNormalize.length} tracks ` +
        `(music: ${LOUDNORM_TARGETS.music} LUFS, ambient: ${LOUDNORM_TARGETS.ambient} LUFS, sfx: ${LOUDNORM_TARGETS.sfx} LUFS, dialogue: ${LOUDNORM_TARGETS.dialogue} LUFS, TP: ${TRUE_PEAK_DBTP} dBTP)`);
    }

    checkAborted(signal);

    // ── Build generation report and write audit trail ──
    function buildStats(results: TrackGenerationResult[]): GenerationStats {
      return {
        planned: results.length,
        succeeded: results.filter(r => r.status === 'success').length,
        fallback: results.filter(r => r.status === 'fallback').length,
        failed: results.filter(r => r.status === 'failed').length,
      };
    }

    const generationReport: GenerationReport = {
      music: { results: musicResults, stats: buildStats(musicResults) },
      ambient: { results: ambientResults, stats: buildStats(ambientResults) },
      sfx: { results: sfxResults, stats: buildStats(sfxResults) },
      ...(dialogueResults.length > 0 ? { dialogue: { results: dialogueResults, stats: buildStats(dialogueResults) } } : {}),
    };

    writeDebug('10_generation_results.json', JSON.stringify(generationReport, null, 2));

    const musicCount = tracks.filter(t => t.type === 'music' && !t.skip).length;
    const ambientTrackCount = tracks.filter(t => t.type === 'ambient').length;
    const sfxTrackCount = tracks.filter(t => t.type === 'sfx').length;
    const dialogueTrackCount = tracks.filter(t => t.type === 'dialogue' && !t.skip).length;
    const parts: string[] = [`${musicCount} music`];
    if (ambientTrackCount > 0) parts.push(`${ambientTrackCount} ambient`);
    if (sfxTrackCount > 0) parts.push(`${sfxTrackCount} SFX`);
    if (dialogueTrackCount > 0) parts.push(`${dialogueTrackCount} dialogue`);
    emit(jobId, {
      stage: 'generating',
      progress: 0.95,
      message: `Generated ${parts.join(' + ')} tracks`,
    });

    // ─── Stage 5: Complete (1.00) ───
    const result: SoundDesignResult = {
      storyAnalysis,
      globalSonicContext,
      soundDesignPlan,
      ...(dialoguePlan ? { dialoguePlan } : {}),
      tracks: tracks.filter(t => !t.skip || t.type !== 'dialogue').sort((a, b) => a.startTimeSec - b.startTimeSec),
      generationReport,
    };

    const finalMusicCount = tracks.filter(t => t.type === 'music' && !t.skip).length;
    const finalAmbientCount = tracks.filter(t => t.type === 'ambient').length;
    const finalSfxCount = tracks.filter(t => t.type === 'sfx').length;
    const finalDialogueCount = tracks.filter(t => t.type === 'dialogue' && !t.skip).length;
    const sfxStats = generationReport.sfx.stats;
    const ambientStats = generationReport.ambient.stats;
    const dialogueStats = generationReport.dialogue?.stats;
    const completeParts: string[] = [`${finalMusicCount} music`];
    if (finalAmbientCount > 0 || ambientStats.failed > 0) {
      completeParts.push(`${finalAmbientCount} ambient`);
    }
    if (finalSfxCount > 0 || sfxStats.failed > 0) {
      completeParts.push(`${finalSfxCount} SFX`);
    }
    if (finalDialogueCount > 0 || (dialogueStats?.failed ?? 0) > 0) {
      completeParts.push(`${finalDialogueCount} dialogue`);
    }
    let completeMsg = `Sound design complete! ${completeParts.join(' + ')} tracks.`;
    const allFallback = sfxStats.fallback + ambientStats.fallback;
    const allFailed = sfxStats.failed + ambientStats.failed + (dialogueStats?.failed ?? 0);
    if (allFallback > 0) completeMsg += ` ${allFallback} recovered via fallback.`;
    if (allFailed > 0) completeMsg += ` ${allFailed} failed.`;
    emit(jobId, {
      stage: 'complete',
      progress: 1.0,
      message: completeMsg,
      result,
    });
  } catch (err: any) {
    if (err.message === 'Aborted') {
      emit(jobId, {
        stage: 'cancelled',
        progress: 0,
        message: 'Pipeline cancelled',
      });
    } else {
      emit(jobId, {
        stage: 'error',
        progress: 0,
        message: `Pipeline failed: ${err.message}`,
        error: err.message,
      });
    }
  }
}
