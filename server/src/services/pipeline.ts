import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { v4 as uuid } from 'uuid';
import { GeneratedTrack, SoundDesignResult, JobProgress, SoundDesignScene, MusicMixLevel } from '../types.js';
import { uploadVideoFile, analyzeStory, createSoundDesignPlan, MODEL } from './gemini.js';
import { generateMusic, generateSoundEffect } from './elevenlabs.js';
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

    // ── Music generation promises ──
    for (let i = 0; i < soundDesignPlan.music_segments.length; i++) {
      const planned = soundDesignPlan.music_segments[i];
      const trackId = uuid();
      const filePath = path.join(audioDir, `music_${trackId}.mp3`);
      const duration = planned.endTime - planned.startTime;

      // Skip segments marked as silent — still add to tracks for display
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

      // Enrich prompt with global context
      let enrichedPrompt = planned.prompt;
      if (soundDesignPlan.global_music_style) {
        enrichedPrompt += `. Style: ${soundDesignPlan.global_music_style}`;
      }
      if (soundDesignPlan.full_video_music_prompt) {
        enrichedPrompt += `. Overall score: ${soundDesignPlan.full_video_music_prompt}`;
      }

      generationPromises.push(
        generateMusic(enrichedPrompt, duration, filePath, elevenLabsApiKey)
          .then(({ actualDurationSec, loop }) => {
            tracks.push({
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
            });
          })
          .catch((err) => {
            console.error(`Failed to generate music:`, err.message);
          }),
      );
    }

    // ── SFX generation promises ──
    if (hasSfx) {
      const sfxSegments = soundDesignPlan.sfx_segments.slice(0, 8); // Hard cap at 8
      for (let i = 0; i < sfxSegments.length; i++) {
        const planned = sfxSegments[i];
        if (planned.skip) continue;

        const trackId = uuid();
        const filePath = path.join(audioDir, `sfx_${trackId}.mp3`);
        const duration = planned.endTime - planned.startTime;

        generationPromises.push(
          generateSoundEffect(planned.prompt, duration, planned.category, filePath, elevenLabsApiKey)
            .then(({ actualDurationSec, loop }) => {
              tracks.push({
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
              });
            })
            .catch((err) => {
              console.error(`Failed to generate SFX:`, err.message);
            }),
        );
      }
    }

    await Promise.all(generationPromises);

    checkAborted(signal);

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
    };

    const finalMusicCount = tracks.filter(t => t.type === 'music' && !t.skip).length;
    const finalSfxCount = tracks.filter(t => t.type === 'sfx').length;
    const completeMsg = finalSfxCount > 0
      ? `Sound design complete! ${finalMusicCount} music + ${finalSfxCount} SFX tracks.`
      : `Sound design complete! Generated ${finalMusicCount} tracks.`;
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
