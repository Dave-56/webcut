import fs from 'fs';
import path from 'path';
import { Job, SSEEvent, JobProgress } from '../types.js';

const DATA_DIR = path.resolve('data/jobs');
// Cleanup disabled — jobs are preserved in data/jobs/ for analysis
// const JOB_TTL_MS = 60 * 60 * 1000;
// const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

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

const JOB_FILE = 'job.json';

export function initJobStore(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Restore jobs from disk: each job lives in data/jobs/<jobId>/job.json
  try {
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const jobPath = path.join(DATA_DIR, ent.name, JOB_FILE);
      try {
        if (!fs.existsSync(jobPath)) continue;
        const raw = fs.readFileSync(jobPath, 'utf-8');
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
        // skip corrupt or missing
      }
    }
  } catch {
    // no data dir yet
  }

  // Periodic cleanup disabled — jobs preserved for analysis
  // setInterval(cleanupOldJobs, CLEANUP_INTERVAL_MS);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function createJob(id: string, videoPath: string): Job {
  const job: Job = {
    id,
    status: 'running',
    videoPath,
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

  // Job files preserved for analysis (cleanup disabled)
  return true;
}

export function setAbortController(jobId: string, controller: AbortController): void {
  const job = jobs.get(jobId);
  if (job) job.abortController = controller;
}

function persistJob(job: Job): void {
  try {
    const jobDir = path.join(DATA_DIR, job.id);
    fs.mkdirSync(jobDir, { recursive: true });
    const { abortController, ...serializable } = job;
    fs.writeFileSync(
      path.join(jobDir, JOB_FILE),
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

  // Clean generated audio directory
  const audioDir = path.resolve('data/jobs', job.id, 'audio');
  try {
    if (fs.existsSync(audioDir)) {
      fs.rmSync(audioDir, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
}

// Cleanup disabled — jobs are preserved in data/jobs/ for analysis
// function cleanupOldJobs(): void {
//   const now = Date.now();
//   for (const [id, job] of jobs) {
//     if (now - job.createdAt > JOB_TTL_MS && job.status !== 'running') {
//       cleanupJobFiles(job);
//       jobs.delete(id);
//       try {
//         fs.rmSync(path.join(DATA_DIR, id), { recursive: true, force: true });
//       } catch { /* ignore */ }
//     }
//   }
// }
