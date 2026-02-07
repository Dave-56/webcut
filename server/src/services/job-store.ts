import fs from 'fs';
import path from 'path';
import { Job, SSEEvent, JobProgress } from '../types.js';

const DATA_DIR = path.resolve('data/jobs');
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// In-memory job registry. Persisted to disk for resilience.
const jobs = new Map<string, Job>();

// One job at a time guard
let activeJobId: string | null = null;

export function getActiveJobId(): string | null {
  return activeJobId;
}

export function setActiveJobId(id: string | null): void {
  activeJobId = id;
}

export function initJobStore(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Restore jobs from disk
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
        const job: Job = JSON.parse(raw);
        // Don't restore abortController (not serializable)
        delete job.abortController;
        // Mark stale running jobs as error
        if (job.status === 'running') {
          job.status = 'error';
          job.events.push({
            id: String(job.events.length),
            data: { stage: 'error', progress: 0, message: 'Server restarted during processing', error: 'Server restarted' },
          });
        }
        jobs.set(job.id, job);
      } catch {
        // skip corrupt files
      }
    }
  } catch {
    // no data dir yet
  }

  // Periodic cleanup
  setInterval(cleanupOldJobs, CLEANUP_INTERVAL_MS);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function createJob(id: string, videoPath: string, targetLanguage?: string): Job {
  const job: Job = {
    id,
    status: 'running',
    videoPath,
    targetLanguage,
    createdAt: Date.now(),
    events: [],
  };
  jobs.set(id, job);
  activeJobId = id;
  persistJob(job);
  return job;
}

export function addEvent(jobId: string, progress: JobProgress): void {
  const job = jobs.get(jobId);
  if (!job) return;

  const event: SSEEvent = {
    id: String(job.events.length),
    data: progress,
  };
  job.events.push(event);

  if (progress.stage === 'complete') {
    job.status = 'complete';
    job.result = progress.result;
    if (activeJobId === jobId) activeJobId = null;
  } else if (progress.stage === 'error') {
    job.status = 'error';
    if (activeJobId === jobId) activeJobId = null;
  } else if (progress.stage === 'cancelled') {
    job.status = 'cancelled';
    if (activeJobId === jobId) activeJobId = null;
  }

  persistJob(job);
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running') return false;

  job.abortController?.abort();
  job.status = 'cancelled';
  if (activeJobId === jobId) activeJobId = null;

  addEvent(jobId, {
    stage: 'cancelled',
    progress: 0,
    message: 'Job cancelled by user',
  });

  // Clean up temp files
  cleanupJobFiles(job);
  return true;
}

export function setAbortController(jobId: string, controller: AbortController): void {
  const job = jobs.get(jobId);
  if (job) job.abortController = controller;
}

function persistJob(job: Job): void {
  try {
    // Strip non-serializable fields
    const { abortController, ...serializable } = job;
    fs.writeFileSync(
      path.join(DATA_DIR, `${job.id}.json`),
      JSON.stringify(serializable, null, 2),
    );
  } catch {
    // best effort
  }
}

function cleanupJobFiles(job: Job): void {
  // Clean video file
  try {
    if (job.videoPath && fs.existsSync(job.videoPath)) {
      fs.unlinkSync(job.videoPath);
    }
  } catch { /* ignore */ }

  // Clean frame directory
  const framesDir = job.videoPath?.replace(/\.[^.]+$/, '_frames');
  try {
    if (framesDir && fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
  } catch { /* ignore */ }

  // Clean generated audio directory
  const audioDir = path.resolve('data/jobs', job.id, 'audio');
  try {
    if (fs.existsSync(audioDir)) {
      fs.rmSync(audioDir, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
}

function cleanupOldJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS && job.status !== 'running') {
      cleanupJobFiles(job);
      jobs.delete(id);
      try {
        fs.unlinkSync(path.join(DATA_DIR, `${id}.json`));
      } catch { /* ignore */ }
    }
  }
}
