import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { SceneAnalysis, GeneratedTrack, SoundDesignResult, JobProgress } from '../types.js';
import { extractFrames, extractAudio, adjustAudioTempo, getAudioDuration } from './video-utils.js';
import { analyzeVideo, translateSpeechSegments } from './gemini.js';
import {
  generateBackgroundMusic,
  generateSoundEffect,
  generateAmbience,
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

export async function runPipeline(config: PipelineConfig): Promise<void> {
  const { jobId, videoPath, targetLanguage, geminiApiKey, elevenLabsApiKey, signal } = config;

  const audioDir = path.resolve('data/jobs', jobId, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });

  const framesDir = videoPath.replace(/\.[^.]+$/, '_frames');

  try {
    // Stage 1: Extract frames and audio
    emit(jobId, {
      stage: 'extracting',
      progress: 0.05,
      message: 'Extracting video frames and audio...',
    });

    checkAborted(signal);

    const audioPath = path.join(audioDir, 'original_audio.wav');
    const [framePaths] = await Promise.all([
      extractFrames(videoPath, framesDir, signal),
      extractAudio(videoPath, audioPath, signal).catch(() => null), // video might have no audio
    ]);

    checkAborted(signal);

    // Stage 2: Gemini analysis
    emit(jobId, {
      stage: 'analyzing',
      progress: 0.15,
      message: `Analyzing ${framePaths.length} frames with Gemini...`,
    });

    const analysis = await analyzeVideo(
      framePaths,
      fs.existsSync(audioPath) ? audioPath : null,
      geminiApiKey,
      signal,
    );

    checkAborted(signal);

    emit(jobId, {
      stage: 'analyzing',
      progress: 0.3,
      message: `Found ${analysis.scenes.length} scenes, ${analysis.soundEffects.length} sound effects, ${analysis.speechSegments.length} speech segments`,
    });

    // Stage 3: Generate sounds in parallel
    emit(jobId, {
      stage: 'generating',
      progress: 0.35,
      message: 'Generating music, sound effects, and ambience...',
    });

    const tracks: GeneratedTrack[] = [];

    // Build all generation promises
    const generationPromises: Promise<void>[] = [];

    // Background music for each scene
    for (const scene of analysis.scenes) {
      const trackId = uuid();
      const filePath = path.join(audioDir, `music_${trackId}.mp3`);
      const duration = scene.endTime - scene.startTime;

      generationPromises.push(
        generateBackgroundMusic(scene.mood, duration, filePath, elevenLabsApiKey)
          .then(({ actualDurationSec, loop }) => {
            tracks.push({
              id: trackId,
              type: 'music',
              filePath,
              startTimeSec: scene.startTime,
              actualDurationSec,
              requestedDurationSec: duration,
              loop,
              label: `Music: ${scene.mood} (${scene.description.slice(0, 30)})`,
            });
          })
          .catch((err) => {
            console.error(`Failed to generate music for scene:`, err.message);
          }),
      );
    }

    // Sound effects
    for (const sfx of analysis.soundEffects) {
      const trackId = uuid();
      const filePath = path.join(audioDir, `sfx_${trackId}.mp3`);

      generationPromises.push(
        generateSoundEffect(sfx.description, sfx.duration, filePath, elevenLabsApiKey)
          .then(({ actualDurationSec }) => {
            tracks.push({
              id: trackId,
              type: 'sfx',
              filePath,
              startTimeSec: sfx.time,
              actualDurationSec,
              requestedDurationSec: sfx.duration,
              loop: false,
              label: `SFX: ${sfx.description}`,
            });
          })
          .catch((err) => {
            console.error(`Failed to generate SFX:`, err.message);
          }),
      );
    }

    // Ambience for each scene
    for (const scene of analysis.scenes) {
      const trackId = uuid();
      const filePath = path.join(audioDir, `ambience_${trackId}.mp3`);
      const duration = scene.endTime - scene.startTime;

      generationPromises.push(
        generateAmbience(scene.suggestedAmbience, duration, filePath, elevenLabsApiKey)
          .then(({ actualDurationSec, loop }) => {
            tracks.push({
              id: trackId,
              type: 'ambience',
              filePath,
              startTimeSec: scene.startTime,
              actualDurationSec,
              requestedDurationSec: duration,
              loop,
              label: `Ambience: ${scene.suggestedAmbience}`,
            });
          })
          .catch((err) => {
            console.error(`Failed to generate ambience:`, err.message);
          }),
      );
    }

    // Run all sound generation in parallel
    await Promise.all(generationPromises);

    checkAborted(signal);

    emit(jobId, {
      stage: 'generating',
      progress: 0.7,
      message: `Generated ${tracks.length} audio tracks`,
    });

    // Stage 4: Dubbing (if target language specified)
    if (targetLanguage && analysis.speechSegments.length > 0) {
      emit(jobId, {
        stage: 'dubbing',
        progress: 0.75,
        message: `Translating speech to ${targetLanguage}...`,
      });

      checkAborted(signal);

      const translatedSegments = await translateSpeechSegments(
        analysis.speechSegments,
        targetLanguage,
        geminiApiKey,
        signal,
      );

      emit(jobId, {
        stage: 'dubbing',
        progress: 0.8,
        message: 'Generating dubbed dialogue...',
      });

      // Generate dubbed speech for each segment
      const dubbingPromises: Promise<void>[] = [];
      for (let i = 0; i < translatedSegments.length; i++) {
        const segment = translatedSegments[i];
        const originalSegment = analysis.speechSegments[i];
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
              // Adjust tempo if speech is too long
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

    // Stage 5: Complete
    const result: SoundDesignResult = {
      analysis,
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
