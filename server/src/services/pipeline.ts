import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { v4 as uuid } from 'uuid';
import { GeneratedTrack, SoundDesignResult, JobProgress, SoundDesignScene, MusicMixLevel, TrackGenerationResult, GenerationStats, GenerationReport } from '../types.js';
import { uploadVideoFile, analyzeStory, createSoundDesignPlan, MODEL } from './gemini.js';
import { generateMusic, generateMusicWithCompositionPlan, generateSoundEffectWithFallback } from './elevenlabs.js';
import type { MusicSegmentInput } from './elevenlabs.js';
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
 * Duration-aware SFX cap: generous enough to never truncate
 * reasonable Gemini output, tight enough to catch hallucinations.
 * ~1 SFX per 10 seconds, floor 8, ceiling 24.
 */
function getSfxCap(durationSec: number): number {
  return Math.max(8, Math.min(24, Math.ceil(durationSec / 10)));
}

/**
 * If SFX count exceeds the cap, drop the most clustered ones
 * (closest to a neighbor) rather than blindly truncating chronologically.
 */
function trimSfxBySpacing<T extends { startTime: number; endTime: number }>(
  segments: T[],
  maxCount: number,
): T[] {
  if (segments.length <= maxCount) return segments;

  // Work on a sorted copy with original indices
  const sorted = segments
    .map((s, i) => ({ seg: s, idx: i }))
    .sort((a, b) => a.seg.startTime - b.seg.startTime);

  while (sorted.length > maxCount) {
    // For each SFX, compute minimum distance to either neighbor
    let minGap = Infinity;
    let dropIdx = 0;
    for (let i = 0; i < sorted.length; i++) {
      const mid = (sorted[i].seg.startTime + sorted[i].seg.endTime) / 2;
      let gap = Infinity;
      if (i > 0) {
        const prevMid = (sorted[i - 1].seg.startTime + sorted[i - 1].seg.endTime) / 2;
        gap = Math.min(gap, mid - prevMid);
      }
      if (i < sorted.length - 1) {
        const nextMid = (sorted[i + 1].seg.startTime + sorted[i + 1].seg.endTime) / 2;
        gap = Math.min(gap, nextMid - mid);
      }
      if (gap < minGap) {
        minGap = gap;
        dropIdx = i;
      }
    }
    sorted.splice(dropIdx, 1);
  }

  // Return in original order
  return sorted.sort((a, b) => a.idx - b.idx).map(s => s.seg);
}

/**
 * Determine whether the composition plan path can be used.
 * Returns false if any scene needs actual volume control that
 * a single continuous track can't provide:
 *  - Any scene with music_level 'off' (needs silence)
 *  - Any dialogue scene with music_level 'low' or 'off' (needs ducking)
 */
function shouldUseCompositionPlan(scenes: SoundDesignScene[]): boolean {
  const hasOffScenes = scenes.some(s => s.music_level === 'off');
  const hasDuckingNeeded = scenes.some(
    s => s.dialogue && (s.music_level === 'low' || s.music_level === 'off'),
  );
  return !hasOffScenes && !hasDuckingNeeded;
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
      progress: 0.30,
      message: `Story analysis complete: ${storyAnalysis.beats.length} beats, genre: ${storyAnalysis.genre}`,
    });

    // ─── Stage 3: Sound Design Plan — Pass 2 (0.30–0.35) ───
    emit(jobId, {
      stage: 'analyzing_sound_design',
      progress: 0.30,
      message: 'Planning sound design...',
    });

    const soundDesignResult = await createSoundDesignPlan(
      storyAnalysis,
      storyAnalysis.durationSec,
      geminiApiKey,
      signal,
      userIntent,
      config.includeSfx,
      videoFileRef,
    );
    const soundDesignPlan = soundDesignResult.data;

    checkAborted(signal);

    // Write Pass 2 debug files (non-blocking)
    writeDebug('4_prompt_sound_design.txt', soundDesignResult.promptSent);
    writeDebug('5_sound_design_raw.txt', soundDesignResult.rawResponse);
    writeDebug('6_sound_design_parsed.json', JSON.stringify(soundDesignPlan, null, 2));

    const sfxCount = soundDesignPlan.sfx_segments?.length ?? 0;
    const sfxMsg = sfxCount > 0 ? `, ${sfxCount} SFX` : '';
    emit(jobId, {
      stage: 'analyzing_sound_design',
      progress: 0.35,
      message: `Sound design plan: ${soundDesignPlan.music_segments.length} music segments${sfxMsg}, style: ${soundDesignPlan.global_music_style}`,
    });

    // ─── Stage 4: Generate music and SFX (0.35–0.95) ───
    const hasSfx = config.includeSfx !== false && (soundDesignPlan.sfx_segments?.length ?? 0) > 0;
    emit(jobId, {
      stage: 'generating',
      progress: 0.35,
      message: hasSfx ? 'Generating music and sound effects...' : 'Generating music...',
    });

    const tracks: GeneratedTrack[] = [];
    const generationPromises: Promise<void>[] = [];
    const musicResults: TrackGenerationResult[] = [];
    const sfxResults: TrackGenerationResult[] = [];

    // Per-track progress tracking
    const sfxCap = getSfxCap(storyAnalysis.durationSec);
    const cappedSfxSegments = hasSfx ? trimSfxBySpacing(soundDesignPlan.sfx_segments, sfxCap) : [];
    const sfxGenerationCount = cappedSfxSegments.filter(s => !s.skip).length;
    const multiSegmentMusicCount = soundDesignPlan.music_segments.filter(m => !m.skip).length;
    let totalGenerations = multiSegmentMusicCount + sfxGenerationCount;
    let completedGenerations = 0;

    function emitGenerationProgress() {
      completedGenerations++;
      const genProgress = 0.35 + (completedGenerations / totalGenerations) * 0.60;
      const sfxFailed = sfxResults.filter(r => r.status === 'failed').length;

      let msg = `Generating audio... (${completedGenerations}/${totalGenerations})`;
      if (sfxFailed > 0) {
        msg += ` — ${sfxFailed} SFX failed`;
      }
      emit(jobId, { stage: 'generating', progress: Math.min(genProgress, 0.95), message: msg });
    }

    // ── Music generation — multi-segment (composition plan disabled) ──
    // Composition plan produces one continuous track, losing per-scene volume
    // ducking and distinct musical character per segment. Re-enable when
    // ElevenLabs supports per-section volume or we split the output post-gen.
    const useCompPlan = false; // was: shouldUseCompositionPlan(soundDesignPlan.scenes);
    let compositionPlanSucceeded = false;

    if (useCompPlan) {
      // Composition plan: one continuous track, sections mapped from Gemini segments
      const nonSkipped = soundDesignPlan.music_segments.filter(s => !s.skip);
      if (nonSkipped.length > 0) {
        // Adjust progress total: 1 composition plan call instead of N individual calls
        totalGenerations = 1 + sfxGenerationCount;

        emit(jobId, {
          stage: 'generating',
          progress: 0.38,
          message: 'Generating music via composition plan...',
        });

        const segments: MusicSegmentInput[] = nonSkipped.map(s => ({
          prompt: s.prompt,
          durationSec: s.endTime - s.startTime,
          genre: s.genre,
          style: s.style,
        }));

        const firstStart = nonSkipped[0].startTime;
        const lastEnd = nonSkipped[nonSkipped.length - 1].endTime;
        const totalDuration = lastEnd - firstStart;
        const trackId = uuid();
        const filePath = path.join(audioDir, `music_${trackId}.mp3`);

        try {
          const result = await generateMusicWithCompositionPlan(
            segments,
            soundDesignPlan.global_music_style,
            soundDesignPlan.full_video_music_prompt,
            totalDuration,
            filePath,
            elevenLabsApiKey,
          );

          const track: GeneratedTrack = {
            id: trackId,
            type: 'music',
            filePath,
            startTimeSec: firstStart,
            actualDurationSec: result.actualDurationSec,
            requestedDurationSec: totalDuration,
            loop: result.loop,
            label: `Music (composition): ${soundDesignPlan.global_music_style}`,
            volume: getVolumeForTrack(firstStart, soundDesignPlan.scenes),
            genre: nonSkipped[0].genre,
            style: nonSkipped[0].style,
          };
          tracks.push(track);
          musicResults.push({
            planned: { type: 'music', prompt: 'composition plan', startTimeSec: firstStart, durationSec: totalDuration },
            status: 'success',
            track, retryCount: 0,
          });

          // Add skipped segments for display
          for (const skipped of soundDesignPlan.music_segments.filter(s => s.skip)) {
            const dur = skipped.endTime - skipped.startTime;
            tracks.push({
              id: uuid(),
              type: 'music',
              filePath: '',
              startTimeSec: skipped.startTime,
              actualDurationSec: dur,
              requestedDurationSec: dur,
              loop: false,
              label: `Music (silent): ${skipped.genre}`,
              volume: 0,
              genre: skipped.genre,
              style: skipped.style,
              skip: true,
            });
          }

          compositionPlanSucceeded = true;
          emitGenerationProgress();
        } catch (err: any) {
          console.warn('Composition plan failed, falling back to multi-segment:', err.message);
          writeDebug('7a_composition_plan_error.txt', err.message);
          // Reset progress total back to multi-segment count
          totalGenerations = multiSegmentMusicCount + sfxGenerationCount;
        }
      }
    }

    // ── Fallback: multi-segment music generation ──
    if (!compositionPlanSucceeded) {
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
        if (soundDesignPlan.global_music_style) {
          enrichedPrompt += `. Style: ${soundDesignPlan.global_music_style}`;
        }
        if (soundDesignPlan.full_video_music_prompt) {
          enrichedPrompt += `. Overall score: ${soundDesignPlan.full_video_music_prompt}`;
        }
        enrichedPrompt += '. Cinematic film score quality, dynamic range. Not stock music or generic corporate.';

        const plannedInfo = { type: 'music' as const, prompt: enrichedPrompt, startTimeSec: planned.startTime, durationSec: duration };

        generationPromises.push(
          generateMusic(enrichedPrompt, duration, filePath, elevenLabsApiKey)
            .then(({ actualDurationSec, loop }) => {
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
              };
              tracks.push(track);
              musicResults.push({
                planned: plannedInfo,
                status: 'success',
                track, retryCount: 0,
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

    // ── SFX generation promises ──
    if (hasSfx) {
      for (let i = 0; i < cappedSfxSegments.length; i++) {
        const planned = cappedSfxSegments[i];
        if (planned.skip) continue;

        const trackId = uuid();
        const filePath = path.join(audioDir, `sfx_${trackId}.mp3`);
        const duration = planned.endTime - planned.startTime;
        const plannedInfo = { type: 'sfx' as const, prompt: planned.prompt, startTimeSec: planned.startTime, durationSec: duration };

        generationPromises.push(
          generateSoundEffectWithFallback(planned.prompt, duration, planned.category, filePath, elevenLabsApiKey)
            .then(({ actualDurationSec, loop, usedFallback, fallbackPrompt, error }) => {
              const track: GeneratedTrack = {
                id: trackId,
                type: 'sfx',
                filePath,
                startTimeSec: planned.startTime,
                actualDurationSec,
                requestedDurationSec: duration,
                loop,
                label: `SFX: ${planned.prompt.slice(0, 50)}`,
                volume: planned.volume,
                category: planned.category,
              };
              tracks.push(track);
              sfxResults.push({
                planned: plannedInfo,
                status: usedFallback ? 'fallback' : 'success',
                track, fallbackPrompt, error, retryCount: 0,
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
      sfx: { results: sfxResults, stats: buildStats(sfxResults) },
    };

    writeDebug('7_generation_results.json', JSON.stringify(generationReport, null, 2));

    const musicCount = tracks.filter(t => t.type === 'music' && !t.skip).length;
    const sfxTrackCount = tracks.filter(t => t.type === 'sfx').length;
    const countMsg = sfxTrackCount > 0
      ? `Generated ${musicCount} music + ${sfxTrackCount} SFX tracks`
      : `Generated ${musicCount} audio tracks`;
    emit(jobId, {
      stage: 'generating',
      progress: 0.95,
      message: countMsg,
    });

    // ─── Stage 5: Complete (1.00) ───
    const result: SoundDesignResult = {
      storyAnalysis,
      soundDesignPlan,
      tracks: tracks.sort((a, b) => a.startTimeSec - b.startTimeSec),
      generationReport,
    };

    const finalMusicCount = tracks.filter(t => t.type === 'music' && !t.skip).length;
    const finalSfxCount = tracks.filter(t => t.type === 'sfx').length;
    const sfxStats = generationReport.sfx.stats;
    let completeMsg = `Sound design complete! ${finalMusicCount} music`;
    if (finalSfxCount > 0 || sfxStats.failed > 0) {
      completeMsg += ` + ${finalSfxCount} SFX`;
      if (sfxStats.fallback > 0) completeMsg += ` (${sfxStats.fallback} recovered via fallback)`;
      if (sfxStats.failed > 0) completeMsg += ` (${sfxStats.failed} failed)`;
    }
    completeMsg += ' tracks.';
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
