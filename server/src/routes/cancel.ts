import { Router } from 'express';
import { cancelJob, getJob } from '../services/job-store.js';

const router = Router();

router.post('/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  if (job.status !== 'running') {
    res.status(400).json({ error: `Job is already ${job.status}` });
    return;
  }

  const cancelled = cancelJob(jobId);
  if (cancelled) {
    res.json({ message: 'Job cancelled successfully' });
  } else {
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

export default router;
