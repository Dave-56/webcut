import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { v4 as uuid } from 'uuid';
import { GeneratedTrack, SoundDesignResult, JobProgress, SoundDesignScene, MusicMixLevel, LoudnessClass, TrackGenerationResult, GenerationStats, GenerationReport, ActionSpotting } from '../types.js';
import { uploadVideoFile, analyzeStory, spotActions, createSoundDesignPlan, MODEL } from './gemini.js';
import { generateMusic, generateSoundEffectWithFallback } from './elevenlabs.js';
import { addEvent } from './job-store.js';

interface PipelineConfig {
  jobId: string;
  videoPath: string;
  userIntent?: string;
  includeSfx?: boolean;
  geminiApiKey: string;
  elevenLabsApiKey: string;
  signal?: AbortSignal;
}

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
    }, null, 2));

    // ─── Stage 2: Story Analysis — Pass 1 (0.15–0.30) ───
    emit(jobId, {
      stage: 'analyzing_story',
      progress: 0.15,
      message: 'Analyzing story...',
    });

    const storyResult = await analyzeStory(videoFileRef, geminiApiKey, signal, userIntent);
    const storyAnalysis = storyResult.data;

    checkAborted(signal);

    // Write Pass 1 debug files (non-blocking)
    writeDebug('1_prompt_story_analysis.txt', storyResult.promptSent);
    writeDebug('2_story_analysis_raw.txt', storyResult.rawResponse);
    writeDebug('3_story_analysis_parsed.json', JSON.stringify(storyAnalysis, null, 2));

    emit(jobId, {
      stage: 'analyzing_story',
      progress: 0.28,
      message: `Story analysis complete: ${storyAnalysis.beats.length} beats, genre: ${storyAnalysis.genre}`,
    });

    // ─── Stage 2.5: Sound Design Plan — Pass 2 (0.28–0.34) ───
    emit(jobId, {
      stage: 'analyzing_sound_design',
      progress: 0.28,
      message: 'Planning sound design...',
    });

    const soundDesignResult = await createSoundDesignPlan(
      videoFileRef,
      storyAnalysis,
      storyAnalysis.durationSec,
      geminiApiKey,
      signal,
      userIntent,
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

      const actionSpottingResult = await spotActions(videoFileRef, storyAnalysis, soundDesignPlan, geminiApiKey, signal);
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

    // ─── Stage 4: Generate music, ambient, and SFX (0.37–0.95) ───
    const hasSfx = config.includeSfx !== false && actionSpotting.actions.length > 0;
    const hasAmbient = (soundDesignPlan.ambient_segments?.length ?? 0) > 0;
    const ambientSegments = soundDesignPlan.ambient_segments ?? [];

    emit(jobId, {
      stage: 'generating',
      progress: 0.37,
      message: hasSfx || hasAmbient ? 'Generating music, ambient, and sound effects...' : 'Generating music...',
    });

    const tracks: GeneratedTrack[] = [];
    const generationPromises: Promise<void>[] = [];
    const musicResults: TrackGenerationResult[] = [];
    const ambientResults: TrackGenerationResult[] = [];
    const sfxResults: TrackGenerationResult[] = [];

    // Per-track progress tracking
    const sfxSegments = hasSfx ? actionSpotting.actions : [];
    const sfxGenerationCount = sfxSegments.length;
    const ambientGenerationCount = ambientSegments.length;
    const multiSegmentMusicCount = soundDesignPlan.music_segments.filter(m => !m.skip).length;
    let totalGenerations = multiSegmentMusicCount + ambientGenerationCount + sfxGenerationCount;
    let completedGenerations = 0;

    function emitGenerationProgress() {
      completedGenerations++;
      const genProgress = 0.37 + (completedGenerations / totalGenerations) * 0.58;
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
                volume: getVolumeForTrack(planned.startTime, soundDesignPlan.scenes),
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
        const plannedInfo = { type: 'ambient' as const, prompt: planned.prompt, startTimeSec: planned.startTime, durationSec: duration };

        generationPromises.push(
          generateSoundEffectWithFallback(planned.prompt, duration, filePath, elevenLabsApiKey, 0.5)
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
                prompt: planned.prompt,
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
        const plannedInfo = { type: 'sfx' as const, prompt: planned.sound, startTimeSec: planned.startTime, durationSec: duration };

        generationPromises.push(
          generateSoundEffectWithFallback(planned.sound, duration, filePath, elevenLabsApiKey, 0.6)
            .then(({ actualDurationSec, loop, retryCount, usedFallback, fallbackPrompt, error }) => {
              const track: GeneratedTrack = {
                id: trackId,
                type: 'sfx',
                filePath,
                startTimeSec: planned.startTime,
                actualDurationSec,
                requestedDurationSec: duration,
                loop,
                label: `SFX: ${planned.action.slice(0, 50)}`,
                volume: getSfxVolume(planned.startTime, soundDesignPlan.scenes),
                prompt: planned.sound,
              };
              tracks.push(track);
              sfxResults.push({
                planned: plannedInfo,
                status: usedFallback ? 'fallback' : 'success',
                track, fallbackPrompt, error, retryCount,
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

    await Promise.all(generationPromises);

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
    };

    writeDebug('10_generation_results.json', JSON.stringify(generationReport, null, 2));

    const musicCount = tracks.filter(t => t.type === 'music' && !t.skip).length;
    const ambientTrackCount = tracks.filter(t => t.type === 'ambient').length;
    const sfxTrackCount = tracks.filter(t => t.type === 'sfx').length;
    const parts: string[] = [`${musicCount} music`];
    if (ambientTrackCount > 0) parts.push(`${ambientTrackCount} ambient`);
    if (sfxTrackCount > 0) parts.push(`${sfxTrackCount} SFX`);
    emit(jobId, {
      stage: 'generating',
      progress: 0.95,
      message: `Generated ${parts.join(' + ')} tracks`,
    });

    // ─── Stage 5: Complete (1.00) ───
    const result: SoundDesignResult = {
      storyAnalysis,
      soundDesignPlan,
      tracks: tracks.sort((a, b) => a.startTimeSec - b.startTimeSec),
      generationReport,
    };

    const finalMusicCount = tracks.filter(t => t.type === 'music' && !t.skip).length;
    const finalAmbientCount = tracks.filter(t => t.type === 'ambient').length;
    const finalSfxCount = tracks.filter(t => t.type === 'sfx').length;
    const sfxStats = generationReport.sfx.stats;
    const ambientStats = generationReport.ambient.stats;
    const completeParts: string[] = [`${finalMusicCount} music`];
    if (finalAmbientCount > 0 || ambientStats.failed > 0) {
      completeParts.push(`${finalAmbientCount} ambient`);
    }
    if (finalSfxCount > 0 || sfxStats.failed > 0) {
      completeParts.push(`${finalSfxCount} SFX`);
    }
    let completeMsg = `Sound design complete! ${completeParts.join(' + ')} tracks.`;
    const allFallback = sfxStats.fallback + ambientStats.fallback;
    const allFailed = sfxStats.failed + ambientStats.failed;
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
