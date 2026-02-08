import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { GeneratedTrack, SoundDesignResult, JobProgress, SoundDesignScene, MixHierarchy } from '../types.js';
import { extractFrames, extractAudio, adjustAudioTempo, getAudioDuration } from './video-utils.js';
import { uploadMediaFiles, analyzeStory, createSoundDesignPlan, translateSpeechSegments } from './gemini.js';
import {
  generateMusic,
  generateSoundEffect,
  generateDubbedSpeech,
} from './elevenlabs.js';
import { addEvent } from './job-store.js';

interface PipelineConfig {
  jobId: string;
  videoPath: string;
  targetLanguage?: string;
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

const DEFAULT_MIX: MixHierarchy = {
  dialogue: 1.0,
  music: 0.4,
  sfx: 0.7,
};

/**
 * Get volume for a track based on its type and the mix hierarchy
 * of the scene containing its start time.
 */
function getVolumeForTrack(
  type: 'music' | 'sfx' | 'dialogue',
  startTimeSec: number,
  scenes: SoundDesignScene[],
): number {
  const scene = scenes.find(s => startTimeSec >= s.startTime && startTimeSec < s.endTime);
  const mix = scene?.mixHierarchy ?? DEFAULT_MIX;

  switch (type) {
    case 'dialogue': return mix.dialogue;
    case 'music': return mix.music;
    case 'sfx': return mix.sfx;
    default: return 0.5;
  }
}

export async function runPipeline(config: PipelineConfig): Promise<void> {
  const { jobId, videoPath, targetLanguage, geminiApiKey, elevenLabsApiKey, signal } = config;

  const audioDir = path.resolve('data/jobs', jobId, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });

  const framesDir = videoPath.replace(/\.[^.]+$/, '_frames');

  try {
    // ─── Stage 1: Extract frames and audio (0.00–0.10) ───
    emit(jobId, {
      stage: 'extracting',
      progress: 0.05,
      message: 'Extracting video frames and audio...',
    });

    checkAborted(signal);

    const audioPath = path.join(audioDir, 'original_audio.wav');
    const [framePaths] = await Promise.all([
      extractFrames(videoPath, framesDir, signal),
      extractAudio(videoPath, audioPath, signal).catch(() => null),
    ]);

    checkAborted(signal);

    // ─── Stage 2: Story Analysis — Pass 1 (0.10–0.30) ───
    emit(jobId, {
      stage: 'analyzing_story',
      progress: 0.10,
      message: `Uploading ${framePaths.length} frames to Gemini...`,
    });

    const fileRefs = await uploadMediaFiles(
      framePaths,
      fs.existsSync(audioPath) ? audioPath : null,
      geminiApiKey,
      signal,
    );

    checkAborted(signal);

    emit(jobId, {
      stage: 'analyzing_story',
      progress: 0.18,
      message: 'Analyzing story...',
    });

    const storyAnalysis = await analyzeStory(fileRefs, geminiApiKey, signal);

    checkAborted(signal);

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

    const soundDesignPlan = await createSoundDesignPlan(storyAnalysis, geminiApiKey, signal);

    checkAborted(signal);

    emit(jobId, {
      stage: 'analyzing_sound_design',
      progress: 0.35,
      message: `Sound design plan: ${soundDesignPlan.music.length} music, ${soundDesignPlan.sfx.length} SFX segments`,
    });

    // ─── Stage 4: Generate music + SFX in parallel (0.35–0.80) ───
    emit(jobId, {
      stage: 'generating',
      progress: 0.35,
      message: 'Generating music and sound effects...',
    });

    const tracks: GeneratedTrack[] = [];
    const generationPromises: Promise<void>[] = [];

    // Music from plan — uses ElevenLabs Music API (up to 5 min per clip)
    for (const planned of soundDesignPlan.music) {
      const trackId = uuid();
      const filePath = path.join(audioDir, `music_${trackId}.mp3`);
      const duration = planned.endTime - planned.startTime;

      generationPromises.push(
        generateMusic(planned.prompt, duration, filePath, elevenLabsApiKey)
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
              volume: getVolumeForTrack('music', planned.startTime, soundDesignPlan.scenes),
            });
          })
          .catch((err) => {
            console.error(`Failed to generate music:`, err.message);
          }),
      );
    }

    // Sound effects from plan — uses ElevenLabs Sound Effects API
    for (const planned of soundDesignPlan.sfx) {
      const trackId = uuid();
      const filePath = path.join(audioDir, `sfx_${trackId}.mp3`);

      generationPromises.push(
        generateSoundEffect(planned.description, planned.duration, planned.category, filePath, elevenLabsApiKey)
          .then(({ actualDurationSec }) => {
            tracks.push({
              id: trackId,
              type: 'sfx',
              filePath,
              startTimeSec: planned.time,
              actualDurationSec,
              requestedDurationSec: planned.duration,
              loop: false,
              label: `SFX [${planned.category}]: ${planned.description}`,
              volume: getVolumeForTrack('sfx', planned.time, soundDesignPlan.scenes),
              sfxCategory: planned.category,
            });
          })
          .catch((err) => {
            console.error(`Failed to generate SFX:`, err.message);
          }),
      );
    }

    await Promise.all(generationPromises);

    checkAborted(signal);

    emit(jobId, {
      stage: 'generating',
      progress: 0.80,
      message: `Generated ${tracks.length} audio tracks`,
    });

    // ─── Stage 5: Dubbing (0.80–0.95) ───
    if (targetLanguage && storyAnalysis.speechSegments.length > 0) {
      emit(jobId, {
        stage: 'dubbing',
        progress: 0.80,
        message: `Translating speech to ${targetLanguage}...`,
      });

      checkAborted(signal);

      const translatedSegments = await translateSpeechSegments(
        storyAnalysis.speechSegments,
        targetLanguage,
        geminiApiKey,
        signal,
      );

      emit(jobId, {
        stage: 'dubbing',
        progress: 0.85,
        message: 'Generating dubbed dialogue...',
      });

      const dubbingPromises: Promise<void>[] = [];
      for (let i = 0; i < translatedSegments.length; i++) {
        const segment = translatedSegments[i];
        const originalSegment = storyAnalysis.speechSegments[i];
        const trackId = uuid();
        const filePath = path.join(audioDir, `dialogue_${trackId}.mp3`);
        const targetDuration = originalSegment.endTime - originalSegment.startTime;

        dubbingPromises.push(
          generateDubbedSpeech(
            segment.text,
            targetLanguage,
            originalSegment.speakerLabel,
            targetDuration,
            filePath,
            elevenLabsApiKey,
          )
            .then(async ({ actualDurationSec }) => {
              let finalPath = filePath;
              let finalDuration = actualDurationSec;
              if (actualDurationSec > targetDuration * 1.2) {
                const adjustedPath = filePath.replace('.mp3', '_adjusted.mp3');
                finalPath = await adjustAudioTempo(filePath, adjustedPath, targetDuration);
                if (finalPath !== filePath) {
                  finalDuration = await getAudioDuration(finalPath);
                }
              }
              tracks.push({
                id: trackId,
                type: 'dialogue',
                filePath: finalPath,
                startTimeSec: originalSegment.startTime,
                actualDurationSec: finalDuration,
                requestedDurationSec: targetDuration,
                loop: false,
                label: `Dialogue: "${segment.text.slice(0, 40)}..."`,
                volume: getVolumeForTrack('dialogue', originalSegment.startTime, soundDesignPlan.scenes),
              });
            })
            .catch((err) => {
              console.error(`Failed to generate dubbed speech:`, err.message);
            }),
        );
      }

      await Promise.all(dubbingPromises);
      checkAborted(signal);
    }

    // ─── Stage 6: Complete (1.00) ───
    const result: SoundDesignResult = {
      storyAnalysis,
      soundDesignPlan,
      tracks: tracks.sort((a, b) => a.startTimeSec - b.startTimeSec),
    };

    emit(jobId, {
      stage: 'complete',
      progress: 1.0,
      message: `Sound design complete! Generated ${tracks.length} tracks.`,
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
