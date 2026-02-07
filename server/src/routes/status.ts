import { Router } from 'express';
import { getJob } from '../services/job-store.js';

const router = Router();

router.get('/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Replay missed events (supports reconnect via Last-Event-ID)
  const lastEventId = req.headers['last-event-id'];
  let startIndex = 0;
  if (lastEventId) {
    const lastIdx = parseInt(lastEventId, 10);
    if (!isNaN(lastIdx)) {
      startIndex = lastIdx + 1;
    }
  }

  // Send all events from startIndex
  for (let i = startIndex; i < job.events.length; i++) {
    const event = job.events[i];
    res.write(`id: ${event.id}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }

  // If job is already complete/error/cancelled, close the connection
  if (job.status !== 'running') {
    res.end();
    return;
  }

  // Poll for new events (check every 500ms)
  let sentCount = job.events.length;
  const interval = setInterval(() => {
    const currentJob = getJob(jobId);
    if (!currentJob) {
      clearInterval(interval);
      res.end();
      return;
    }

    // Send any new events
    while (sentCount < currentJob.events.length) {
      const event = currentJob.events[sentCount];
      res.write(`id: ${event.id}\n`);
      res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      sentCount++;
    }

    // Close connection when job finishes
    if (currentJob.status !== 'running') {
      clearInterval(interval);
      res.end();
    }
  }, 500);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
  });
});

export default router;
