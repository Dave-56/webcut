import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { checkFfmpeg } from './services/video-utils.js';
import { initJobStore } from './services/job-store.js';
import analyzeRouter from './routes/analyze.js';
import statusRouter from './routes/status.js';
import audioRouter from './routes/audio.js';
import cancelRouter from './routes/cancel.js';

// Verify ffmpeg is available
try {
  checkFfmpeg();
  console.log('ffmpeg: OK');
} catch (err: any) {
  console.error(err.message);
  process.exit(1);
}

// Initialize job persistence
initJobStore();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/analyze', analyzeRouter);
app.use('/api/status', statusRouter);
app.use('/api/audio', audioRouter);
app.use('/api/cancel', cancelRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`AI Sound Design server running on http://localhost:${PORT}`);
});
