import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';

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
 * Trim audio to an exact duration with a short fade-out at the cut point.
 * If the file is already shorter than the target, returns the input path as-is.
 */
export async function trimAudioToLength(
  inputPath: string,
  outputPath: string,
  targetDurationSec: number,
  fadeOutSec = 0.5,
): Promise<string> {
  const actualDuration = await getAudioDuration(inputPath);
  if (actualDuration <= targetDurationSec) return inputPath;

  const fadeStart = Math.max(0, targetDurationSec - fadeOutSec);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .duration(targetDurationSec)
      .audioFilter(`afade=t=out:st=${fadeStart}:d=${fadeOutSec}`)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
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

// ─── EBU R128 Loudness Normalization ───

/** LUFS targets per track type — calibrated for multi-track mixing. */
export const LOUDNORM_TARGETS = {
  music:   -24,  // bed level, sits under dialogue
  ambient: -28,  // felt not heard; volume tables provide the rest
  sfx:     -18,  // punchy, present; scene-context ducking handles the mix
} as const;

/** True-peak ceiling: -2 dBTP leaves headroom for multi-track summing. */
export const TRUE_PEAK_DBTP = -2.0;

/** Minimum duration (seconds) for meaningful EBU R128 measurement. */
const MIN_LUFS_DURATION = 0.5;

export interface LoudnessStats {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
}

/**
 * Measure EBU R128 loudness statistics for an audio file (loudnorm pass 1).
 * Returns the four values needed for an accurate dual-pass normalization.
 */
export function measureLoudness(inputPath: string): Promise<LoudnessStats> {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -hide_banner -i "${inputPath}" -af loudnorm=print_format=json -f null -`;

    exec(cmd, { maxBuffer: 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(`loudnorm measurement failed: ${err.message}`));

      // ffmpeg prints the JSON stats to stderr
      const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
      if (!jsonMatch) return reject(new Error('Could not parse loudnorm stats from ffmpeg output'));

      try {
        const stats = JSON.parse(jsonMatch[0]);
        resolve({
          input_i: parseFloat(stats.input_i),
          input_tp: parseFloat(stats.input_tp),
          input_lra: parseFloat(stats.input_lra),
          input_thresh: parseFloat(stats.input_thresh),
        });
      } catch (parseErr: any) {
        reject(new Error(`Failed to parse loudnorm JSON: ${parseErr.message}`));
      }
    });
  });
}

/**
 * Normalize audio to a target LUFS using ffmpeg loudnorm (EBU R128 dual-pass).
 * - Files shorter than 0.5s are returned as-is (too short for LUFS measurement).
 * - Uses linear mode for transparent gain without dynamic compression artifacts.
 * - Follows the same input/output pattern as trimAudioToLength and adjustAudioTempo.
 */
export async function normalizeAudio(
  inputPath: string,
  outputPath: string,
  targetLufs: number = LOUDNORM_TARGETS.music,
  truePeak: number = TRUE_PEAK_DBTP,
): Promise<string> {
  const duration = await getAudioDuration(inputPath);
  if (duration < MIN_LUFS_DURATION) return inputPath;

  // Pass 1: measure
  const stats = await measureLoudness(inputPath);

  // If already within 0.5 LU of target, skip processing
  if (Math.abs(stats.input_i - targetLufs) < 0.5) return inputPath;

  // Pass 2: apply normalization with measured values
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilter(
        `loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=11:` +
        `measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:` +
        `measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:` +
        `linear=true:print_format=none`,
      )
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}
