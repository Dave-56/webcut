import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { checkFfmpeg } from './services/video-utils.js';
import { initJobStore } from './services/job-store.js';
import analyzeRouter from './routes/analyze.js';
import statusRouter from './routes/status.js';
import audioRouter from './routes/audio.js';
import cancelRouter from './routes/cancel.js';
import regenerateSfxRouter from './routes/regenerate-sfx.js';

// Verify ffmpeg is available
try {
  checkFfmpeg();
  console.log('ffmpeg: OK');
} catch (err: any) {
  console.error(err.message);
  process.exit(1);
}

// Check optional API keys
if (!process.env.OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY not set — prompt rewriting for ElevenLabs will be skipped');
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
app.use('/api/regenerate-sfx', regenerateSfxRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`AI Sound Design server running on http://localhost:${PORT}`);
});
