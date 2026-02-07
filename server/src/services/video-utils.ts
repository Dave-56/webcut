import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Verify ffmpeg is available at startup
export function checkFfmpeg(): void {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch {
    throw new Error(
      'ffmpeg is not installed or not found in PATH. ' +
      'Install it with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)',
    );
  }
}

export interface FrameSamplingConfig {
  interval: number;
  maxFrames: number;
}

export function calculateFrameSampling(durationSec: number): FrameSamplingConfig {
  const MAX_FRAMES = 80;
  if (durationSec <= MAX_FRAMES) {
    return { interval: 1, maxFrames: Math.ceil(durationSec) };
  }
  const interval = Math.ceil(durationSec / MAX_FRAMES);
  return { interval, maxFrames: MAX_FRAMES };
}

/** Get video duration in seconds using ffprobe */
export function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

/** Get audio file duration in seconds using ffprobe */
export function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

/**
 * Extract keyframes from video using adaptive sampling.
 * For videos > 5 min, uses scene-change detection (capped at 80 frames).
 * Returns array of frame file paths.
 */
export async function extractFrames(
  videoPath: string,
  outputDir: string,
  signal?: AbortSignal,
): Promise<string[]> {
  fs.mkdirSync(outputDir, { recursive: true });

  const durationSec = await getVideoDuration(videoPath);
  const { interval, maxFrames } = calculateFrameSampling(durationSec);

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Aborted'));

    let filter: string;
    if (durationSec > 300) {
      // For long videos, use scene detection capped at maxFrames
      filter = `select='gt(scene\\,0.3)',scale=640:-1`;
    } else {
      filter = `fps=1/${interval},scale=640:-1`;
    }

    const command = ffmpeg(videoPath)
      .outputOptions([
        '-vf', filter,
        '-frames:v', String(maxFrames),
        '-q:v', '5',
      ])
      .output(path.join(outputDir, 'frame_%04d.jpg'))
      .on('end', () => {
        const files = fs.readdirSync(outputDir)
          .filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
          .sort()
          .map(f => path.join(outputDir, f));
        resolve(files);
      })
      .on('error', (err) => {
        reject(err);
      });

    if (signal) {
      signal.addEventListener('abort', () => {
        command.kill('SIGKILL');
        reject(new Error('Aborted'));
      }, { once: true });
    }

    command.run();
  });
}

/**
 * Extract audio track from video as WAV.
 * Returns the path to the extracted audio file.
 */
export async function extractAudio(
  videoPath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<string> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Aborted'));

    const command = ffmpeg(videoPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err));

    if (signal) {
      signal.addEventListener('abort', () => {
        command.kill('SIGKILL');
        reject(new Error('Aborted'));
      }, { once: true });
    }

    command.run();
  });
}

/**
 * Adjust audio playback rate to fit a target duration.
 * Capped at 1.3x to avoid distortion.
 */
export async function adjustAudioTempo(
  inputPath: string,
  outputPath: string,
  targetDurationSec: number,
): Promise<string> {
  const actualDuration = await getAudioDuration(inputPath);
  if (actualDuration <= 0) return inputPath;

  const ratio = actualDuration / targetDurationSec;
  // Only adjust if significantly longer than target (>120%)
  if (ratio <= 1.2) return inputPath;

  // Cap at 1.3x
  const tempo = Math.min(ratio, 1.3);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilter(`atempo=${tempo}`)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}
