import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { createJob, getActiveJobId, setAbortController } from '../services/job-store.js';
import { runPipeline } from '../services/pipeline.js';

const uploadDir = path.resolve('uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/mpeg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

const router = Router();

router.post('/', upload.single('video'), (req, res) => {
  // Concurrent job guard
  const activeId = getActiveJobId();
  if (activeId) {
    // Clean up uploaded file
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
    res.status(409).json({
      error: 'A job is already in progress',
      activeJobId: activeId,
    });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'No video file provided' });
    return;
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;

  if (!geminiApiKey || !elevenLabsApiKey) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Server is missing required API keys (GEMINI_API_KEY, ELEVENLABS_API_KEY)' });
    return;
  }

  const jobId = uuid();
  const userIntent = req.body?.userIntent || undefined;
  const includeSfx = req.body?.includeSfx !== 'false'; // default: true
  const includeDialogue = req.body?.includeDialogue === 'true';
  const dialogueScript = req.body?.dialogueScript || undefined;

  // Validate contentType against allowlist
  const VALID_CONTENT_TYPES = ['youtube', 'podcast', 'short-form', 'film', 'commercial', 'streaming'];
  const rawContentType = req.body?.contentType;
  if (rawContentType && !VALID_CONTENT_TYPES.includes(rawContentType)) {
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: `Invalid contentType: ${rawContentType}` });
    return;
  }
  const contentType: string | undefined = rawContentType || undefined;

  const job = createJob(jobId, req.file.path);

  // Set up abort controller
  const abortController = new AbortController();
  setAbortController(jobId, abortController);

  // Run pipeline in background
  runPipeline({
    jobId,
    videoPath: req.file.path,
    userIntent,
    includeSfx,
    includeDialogue,
    dialogueScript,
    contentType,
    geminiApiKey,
    elevenLabsApiKey,
    signal: abortController.signal,
  });

  res.json({ jobId });
});

// Handle multer errors
router.use((err: any, _req: any, res: any, _next: any) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File too large. Maximum size is 500MB.' });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message });
    return;
  }
});

export default router;
