# AI Sound Design Automation Tool — Implementation Plan

## Context

We're transforming this forked WebCut video editor into an AI-powered sound design
automation tool. The core idea: a user uploads a video, and the app automatically
analyzes scenes (via Gemini), generates appropriate audio layers — background music,
ambience, sound effects, and lip-sync dubbing (via ElevenLabs) — and populates the
timeline. The existing WebCut editor provides the video player, timeline, and audio
rendering infrastructure we need. We'll strip the UI to essentials and add an AI
pipeline on top.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Vue 3 + TypeScript)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ Video Upload  │  │ Player +     │  │ AI Status Panel   │ │
│  │ Drop Zone     │  │ Preview      │  │ (progress, logs)  │ │
│  │ + Lang Select │  └──────────────┘  └───────────────────┘ │
│  └──────────────┘                                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Timeline (auto-populated rails: music, sfx,          │   │
│  │ ambience, dialogue) — minimal manual editing          │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ AI Service Client (src/services/ai-client.ts)        │   │
│  │ Calls backend API, handles SSE progress streaming     │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  Backend (Express + TypeScript)  — server/                  │
│  ┌────────────┐ ┌──────────────┐ ┌────────────────────┐    │
│  │ POST       │ │ Scene        │ │ Sound Generation   │    │
│  │ /analyze   │ │ Analysis     │ │ (ElevenLabs)       │    │
│  │ (upload)   │ │ (Gemini)     │ │ music/sfx/ambience │    │
│  └────────────┘ └──────────────┘ └────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐     │
│  │ Dubbing Pipeline                                    │    │
│  │ Gemini transcribe → translate → ElevenLabs voice    │    │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Backend Server Setup

### New files

- `server/` directory at project root
- `server/package.json` — Express, multer, @google/generative-ai, dotenv, cors, typescript
- `server/tsconfig.json`
- `server/.env.example` — Template with GEMINI_API_KEY=, ELEVENLABS_API_KEY= (actual .env is gitignored)
- `server/.gitignore` — Ignore .env, node_modules/, data/
- `server/src/index.ts` — Express app entry point
- `server/src/routes/analyze.ts` — POST /api/analyze (accepts video upload via multer, triggers full pipeline)
- `server/src/routes/status.ts` — GET /api/status/:jobId (SSE stream for progress)
- `server/src/routes/audio.ts` — GET /api/audio/:jobId/:trackId (serves generated audio with CORS + Content-Type headers)
- `server/src/routes/cancel.ts` — POST /api/cancel/:jobId (aborts pipeline, cleans up temp files)
- `server/src/services/gemini.ts` — Gemini scene analysis service
- `server/src/services/elevenlabs.ts` — ElevenLabs sound generation service (with built-in exponential backoff)
- `server/src/services/pipeline.ts` — Orchestration: analysis → parallel generation → response
- `server/src/services/video-utils.ts` — ffmpeg-based frame extraction & audio extraction
- `server/src/services/job-store.ts` — Job state persistence (JSON file-based) + temp file cleanup
- `server/src/types.ts` — Shared types for API contracts

### API Endpoints

**POST /api/analyze**
- Accepts: multipart/form-data with video file + optional targetLanguage for dubbing
- Upload size limit: `multer({ limits: { fileSize: 500 * 1024 * 1024 } })` — 500MB cap. Return 413 with clear error message on overflow.
- Concurrent job guard: If a job is already running, return 409 Conflict. Only one job at a time per server instance. Frontend disables upload zone while a job is active and shows a "Cancel" button.
- Process:
  1. Save uploaded video to temp dir
  2. Extract keyframes using adaptive sampling (see Frame Sampling Strategy below)
  3. Extract audio track as WAV using ffmpeg
  4. Upload frames to Gemini via File API (see Gemini Payload Strategy below)
  5. Send file references + audio to Gemini for scene analysis
  6. Return job ID immediately, process in background
  7. After analysis, run sound generation in parallel (music + SFX + ambience concurrently via Promise.all)
  8. If targetLanguage is set, run dubbing pipeline after analysis (can overlap with sound generation)
- Response: `{ jobId: string }`

**GET /api/status/:jobId** (Server-Sent Events)
- Streams progress updates as the pipeline processes:
  - `{ stage: "analyzing", progress: 0.2, message: "Analyzing scenes..." }`
  - `{ stage: "generating", progress: 0.5, message: "Generating music, SFX, ambience..." }`
  - `{ stage: "dubbing", progress: 0.8, message: "Generating dubbed dialogue..." }`
  - `{ stage: "complete", progress: 1.0, result: SoundDesignResult }`
- On reconnect: client sends Last-Event-ID header; server replays missed events from job-store

**GET /api/audio/:jobId/:trackId**
- Serves generated audio files
- Must set: Content-Type: audio/mpeg (or appropriate type), Access-Control-Allow-Origin: * CORS headers
- Note: Frontend will fetch as Blob and convert to File object before pushing to timeline

**POST /api/cancel/:jobId**
- Aborts the running pipeline for the given job
- Cleans up temp files (video, frames, generated audio)
- Sets job status to "cancelled" in job-store
- Returns 200 on success, 404 if job not found

### Frame Sampling Strategy

Instead of naive 1-frame-per-second extraction:

```typescript
function calculateFrameSampling(durationSec: number): { interval: number; maxFrames: number } {
  const MAX_FRAMES = 80;  // stay well within Gemini's multimodal limits
  if (durationSec <= MAX_FRAMES) {
    return { interval: 1, maxFrames: durationSec };  // 1fps for short videos
  }
  // For longer videos, space frames evenly
  const interval = Math.ceil(durationSec / MAX_FRAMES);
  return { interval, maxFrames: MAX_FRAMES };
}
```

Additionally, use ffmpeg scene-change detection (`select='gt(scene,0.3)'`) as a secondary strategy for videos > 5 minutes, capped at 80 frames.

### Gemini Payload Strategy

Sending 80 frames as inline base64 would produce 8-40MB request payloads. Instead, use the Gemini File API:

```typescript
import { GoogleAIFileManager } from '@google/generative-ai/server';

const fileManager = new GoogleAIFileManager(apiKey);

// Upload each frame, get URI references
const fileRefs = await Promise.all(
  framePaths.map(async (path) => {
    const upload = await fileManager.uploadFile(path, { mimeType: 'image/jpeg' });
    return { fileData: { fileUri: upload.file.uri, mimeType: 'image/jpeg' } };
  })
);

// Pass URIs (not bytes) to the generation request
const result = await model.generateContent([
  ...fileRefs,
  { text: analysisPrompt },
]);
```

This is more reliable, avoids request size limits, and lets Gemini process frames server-side. Files are auto-deleted by Google after 48h.

### Gemini Integration (`server/src/services/gemini.ts`)

```typescript
interface SceneAnalysis {
  scenes: Array<{
    startTime: number;    // seconds
    endTime: number;
    description: string;
    mood: string;         // "tense", "peaceful", "energetic", etc.
    suggestedAmbience: string;  // "forest", "city traffic", "ocean waves"
  }>;
  speechSegments: Array<{
    startTime: number;
    endTime: number;
    text: string;         // transcribed speech
    language: string;     // detected language
    speakerLabel: string; // "speaker_1", "speaker_2"
  }>;
  soundEffects: Array<{
    time: number;         // seconds
    duration: number;
    description: string;  // "door slam", "footsteps on gravel"
  }>;
  overallMood: string;
}
```

- Use gemini-2.0-flash for multimodal analysis
- Send video frames via File API URIs + audio for comprehensive analysis
- Prompt engineered to return structured JSON matching the interface above

### ElevenLabs Integration (`server/src/services/elevenlabs.ts`)

Four generation functions:
1. `generateBackgroundMusic(mood, durationSec)` — ElevenLabs sound effects API with music-oriented prompts
2. `generateSoundEffect(description, durationSec)` — ElevenLabs Sound Effects API
3. `generateAmbience(description, durationSec)` — ElevenLabs Sound Effects API for ambient loops
4. `generateDubbedSpeech(text, targetLang, voiceId, durationSec)` — ElevenLabs Text-to-Speech with timing constraints

**Duration cap handling:** The ElevenLabs Sound Effects API caps output at ~22 seconds. For scenes longer than 20s:
- Music & ambience: Generate a ~20s clip. The backend response includes `{ actualDuration, loop: true }` metadata. The frontend sets the segment duration to match the scene but the underlying audio loops.
- If AudioClip doesn't support native looping, stitch: generate multiple ~20s clips and push them sequentially on the same rail, end-to-end.

**Duration mismatch handling:** Generated audio may not match requested duration.
- For SFX: Use the actual generated duration as the segment duration (not the requested one). The backend measures output duration with ffprobe and returns `actualDurationSec` per track.
- For TTS dubbing: If the generated speech is shorter than the original segment, accept it (small gap is better than stretched audio). If significantly longer (>120% of target), use ffmpeg to adjust playback rate to fit: `ffmpeg -i input.mp3 -filter:a "atempo=1.2" output.mp3` (capped at 1.3x to avoid distortion).

**Built-in retry with exponential backoff:**

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      if (err.status === 429 || err.status >= 500) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;  // non-retryable error
    }
  }
  throw new Error('Unreachable');
}
```

All four generation functions wrap their API calls with `withRetry()`.

### Job Store & Cleanup (`server/src/services/job-store.ts`)

- Persist job state to `server/data/jobs/{jobId}.json` — survives server restarts
- Auto-create `data/jobs/` directory on startup with `mkdirSync('data/jobs', { recursive: true })`
- Store SSE event history per job so reconnecting clients get replayed events
- TTL-based cleanup: jobs older than 1 hour are deleted along with their temp files (video, frames, generated audio)
- Cleanup runs on a setInterval every 10 minutes

### Dependencies

- express, cors, multer, dotenv — server basics
- @google/generative-ai — Gemini SDK (includes @google/generative-ai/server for File API)
- elevenlabs — ElevenLabs SDK
- fluent-ffmpeg — video frame/audio extraction
- typescript, tsx — TypeScript runtime
- uuid — job ID generation

**ffmpeg requirement:** fluent-ffmpeg requires ffmpeg to be installed on the system. Do NOT use @ffmpeg-installer/ffmpeg as it downloads platform-specific binaries that break in CI/Docker. Instead:
- Document in README: "Requires ffmpeg installed (`brew install ffmpeg` on macOS)"
- `video-utils.ts` checks for ffmpeg availability at startup and throws a clear error if missing

---

## Phase 2: Frontend UI

### New layout for `src/views/ai-editor/index.vue`

```
┌─────────────────────────────────────────────────────────┐
│  [Logo/Title]           [Export Button]                  │
├─────────────────────────────────────────────────────────┤
│                    │                                     │
│  Upload Zone /     │  AI Status Panel                    │
│  Player Preview    │  (progress steps, generated tracks) │
│                    │                                     │
│  [Play Controls]   │  [Target Language Dropdown]         │
├────────────────────┴─────────────────────────────────────┤
│  Timeline (auto-populated, minimal editing)              │
│  Music     |████████████████████████████|                │
│  SFX       |██  ███  █  ████  ██|                       │
│  Ambience  |████████████████████████████|                │
│  Dialogue  |███  ████   ████  ███|                      │
└──────────────────────────────────────────────────────────┘
```

**Critical: WebCutProvider wrapper.**
The new `ai-editor/index.vue` must wrap all content in `<WebCutProvider>`, which creates and provides the root context via `useWebCutContext()`. Without this, all inject-based composables (`useWebCutPlayer()`, `useWebCutManager()`, etc.) will fail with undefined context. Pattern from existing `src/views/editor/index.vue`.

### Changes from original editor

- Remove WebCutLibrary import and left panel
- Remove Panel import and right property panel
- Remove ThemeSwitch
- Replace left panel with either upload dropzone (no video loaded) or player (video loaded)
- Add new AiStatusPanel component on the right side
- Add target language dropdown to upload zone or AI status panel
- Keep WebCutManager (timeline) at the bottom
- Keep ExportButton

### `dev/App.vue` modification

- Replace `<WebCutEditor />` with `<AiEditor />`
- Import directly: `import AiEditor from '../src/views/ai-editor/index.vue'` (NOT from barrel export)
- The barrel export (`src/index.ts`) stays untouched

### New frontend files

- `src/views/ai-editor/index.vue` — New top-level editor with `<WebCutProvider>` wrapper
- `src/views/ai-editor/upload-zone.vue` — Drag-and-drop video upload with language dropdown
- `src/views/ai-editor/ai-status-panel.vue` — Shows pipeline progress (steps, spinners, track list)
- `src/services/ai-client.ts` — HTTP client for backend API + SSE listener
- `src/hooks/ai-pipeline.ts` — Composable that orchestrates: upload → poll status → download audio → push to timeline

---

## Phase 3: AI Pipeline Composable (`src/hooks/ai-pipeline.ts`)

This is the core orchestration on the frontend. It:

1. Uploads the video file to POST /api/analyze AND simultaneously pushes it to the player via `push('video', file)`
2. Listens to GET /api/status/:jobId via SSE for progress
3. Downloads each generated audio as a Blob, wraps as File object
4. Pushes each audio File to the timeline using `useWebCutPlayer().push()` with explicit rail IDs

### Dual Video Path

When the user uploads a video:

```typescript
async function startPipeline(file: File, targetLanguage?: string) {
  // 1. Push video to WebCut player immediately (local playback)
  await push('video', file);

  // 2. Upload same file to backend for AI analysis
  const { jobId } = await aiClient.analyze(file, targetLanguage);

  // 3. Listen for progress and results
  listenToStatus(jobId);
}
```

This avoids double transfer — the same File object is used for both paths.

### Audio Source Handling

Frontend always fetches audio as Blob and converts to File before calling `push()`:

```typescript
async function downloadAndPushAudio(
  jobId: string,
  trackId: string,
  filename: string,
  railId: string,
  opts: { volume: number; startUs: number; durationUs: number }
) {
  const blob = await aiClient.downloadAudio(jobId, trackId);
  const file = new File([blob], filename, { type: 'audio/mpeg' });
  await push('audio', file, {
    audio: { volume: opts.volume },
    time: { start: opts.startUs, duration: opts.durationUs },
    withRailId: railId,
  });
}
```

This ensures: (a) no CORS issues in production, (b) files get persisted to IndexedDB via WebCut's storage layer.

**Duration from backend:** The SoundDesignResult includes `actualDurationSec` per track (measured by ffprobe on the server). The frontend uses this instead of the requested duration for SFX segments. For music/ambience where the clip is shorter than the scene, the full scene duration is used (audio loops or clips are stitched server-side).

**Upload zone disabled during active job:** The pipeline composable exposes a reactive `isProcessing` ref. The upload zone component watches this and disables drop/click when true, showing a "Cancel" button instead.

### Explicit Rail Management

**Critical:** The `push()` method's `withRailId` only works if the rail already exists (branch 1 of the logic at `src/hooks/index.ts` lines 728-761). If the rail doesn't exist, it falls to the else branch and may add segments to an unrelated audio rail that has no time overlap. We must **pre-create empty rails** before any push calls.

```typescript
import { createRandomString } from 'ts-fns';  // from ts-fns dependency, NOT from src/libs

const musicRailId = createRandomString(16);
const sfxRailId = createRandomString(16);
const ambienceRailId = createRandomString(16);
const dialogueRailId = createRandomString(16);

// Pre-create empty rails so withRailId always hits branch 1
const { rails } = useWebCutContext();
rails.value.push(
  { id: musicRailId, type: 'audio', segments: [], transitions: [] },
  { id: sfxRailId, type: 'audio', segments: [], transitions: [] },
  { id: ambienceRailId, type: 'audio', segments: [], transitions: [] },
  { id: dialogueRailId, type: 'audio', segments: [], transitions: [] },
);

// Now all pushes land on the correct rail
await downloadAndPushAudio(jobId, track.id, 'music.mp3', musicRailId, {
  volume: 0.3,
  startUs: scene.startTime * 1e6,
  durationUs: (scene.endTime - scene.startTime) * 1e6,
});

await downloadAndPushAudio(jobId, track.id, 'sfx.mp3', sfxRailId, {
  volume: 0.9,
  startUs: effect.time * 1e6,
  durationUs: effect.actualDurationSec * 1e6,  // use actual duration from ffprobe
});

await downloadAndPushAudio(jobId, track.id, 'ambience.mp3', ambienceRailId, {
  volume: 0.25,
  startUs: scene.startTime * 1e6,
  durationUs: (scene.endTime - scene.startTime) * 1e6,
});

await downloadAndPushAudio(jobId, track.id, 'dialogue.mp3', dialogueRailId, {
  volume: 1.0,
  startUs: speech.startTime * 1e6,
  durationUs: (speech.endTime - speech.startTime) * 1e6,
});
```

### Clearing Timeline

`useWebCutPlayer().clear()` does not exist. To clear the timeline before re-populating, iterate sources and call `remove()` for each:

```typescript
function clearTimeline() {
  const { sources } = useWebCutContext();
  for (const [id] of sources.value) {
    remove(id);
  }
}
```

### Original Video Audio Handling

**Important:** `VisibleSprite` from @webav/av-cliper may not expose a mutable volume property after clip creation. Video volume is set at `MP4Clip` construction time (see `src/hooks/index.ts` lines 516-519). To change it after the fact, we must remove and re-push the video with the desired volume.

**Also important:** `WebCutSource` stores `fileId: string` and `railId: string` / `segmentId: string` — NOT a `file` object or `segment` object. To get the original file, use the `file:` prefix with `fileId`. To get timing, look up the segment from the rail.

```typescript
if (targetLanguage) {
  const { sources, rails } = useWebCutContext();
  for (const [id, source] of sources.value) {
    if (source.type === 'video') {
      // Look up timing from the rail's segment (source has railId + segmentId, not segment object)
      const rail = rails.value.find(r => r.id === source.railId);
      const segment = rail?.segments.find(s => s.id === source.segmentId);
      const startTime = segment?.start ?? 0;
      const duration = segment ? segment.end - segment.start : undefined;

      // Use fileId to reference the stored file (source has fileId, not file object)
      const videoFileId = source.fileId;
      await remove(id);

      // Re-push with near-mute volume using file: prefix
      await push('video', `file:${videoFileId}`, {
        video: { volume: 0.05 },
        time: { start: startTime, duration },
      });
      break;  // only one video source expected
    }
  }
}
```

**Fallback:** If the above is too disruptive (loses sprite position), verify at implementation time whether MP4Clip or the sprite exposes a volume setter. If it does, use that instead.

### Existing utilities we'll reuse

- `useWebCutPlayer().push()` — `src/hooks/index.ts`
- `useWebCutPlayer().remove()` — remove individual sources
- `useWebCutPlayer().play()`, `.pause()` — playback
- `useWebCutPlayer().exportBlob()` / `.download()` — export final video
- `useWebCutContext()` — access rails, sources, status
- `useWebCutToast()` — show success/error notifications
- `useWebCutLoading()` — loading states
- `measureAudioDuration()` / `measureVideoDuration()` — from `src/libs/index.ts`
- `createRandomString()` — from `ts-fns` (third-party dependency)

---

## Phase 4: Dubbing/Lip-sync Pipeline

This is the most complex feature. The flow:

1. Gemini transcribes original speech segments with timestamps and speaker labels
2. Gemini translates the transcribed text to the target language
3. ElevenLabs generates new speech for each segment:
   - Use ElevenLabs TTS with timing constraints
   - Match the duration of the original speech segment
   - Each speaker gets a consistent voice (map speaker labels → ElevenLabs voice IDs)
4. Frontend receives individual dubbed audio clips with their timestamps
5. Push each clip to the "Dialogue" rail on the timeline (using `dialogueRailId`)
6. Mute/reduce original video audio (remove + re-push with `volume: 0.05`)

### Backend implementation

- The `targetLanguage` param on `/api/analyze` triggers the dubbing sub-pipeline
- Speech segments from Gemini analysis are passed to ElevenLabs TTS
- Speaker label → voice ID mapping is maintained per job
- Each dubbed segment is stored as a separate audio file and referenced in the result
- Dubbing runs in parallel with sound generation (both start after analysis completes)

### Target language selection UI

- The upload zone component includes a language dropdown (English, Spanish, French, German, Japanese, Chinese, etc.)
- Default: no dubbing (dropdown shows "No dubbing")
- When a language is selected, it's passed as `targetLanguage` to the backend

---

## Phase 5: Config & Export

### Vite proxy config

Add a dev proxy in `vite.config.ts` so frontend dev server forwards /api/* to the Express backend:

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:3001'
  }
}
```

### Package.json scripts

Add to root `package.json` (using pnpm consistently):

```json
"dev:server": "cd server && pnpm tsx watch src/index.ts",
"dev:all": "concurrently \"pnpm dev\" \"pnpm dev:server\""
```

### SSE Reconnection

- Frontend EventSource auto-reconnects on disconnect
- Backend stores event history per job in job-store.ts
- On reconnect, Last-Event-ID is sent; server replays missed events
- If job completed while disconnected, the complete event (with full result) is replayed

### Export flow

- Keep existing WebCutExportButton and `useWebCutPlayer().download()`
- The export mixes all audio rails with the video automatically (handled by AVCanvas/av-cliper)

---

## Files to Modify

| File | Change |
|------|--------|
| `dev/App.vue` | Replace `<WebCutEditor />` with `<AiEditor />`, import from `../src/views/ai-editor/index.vue` |
| `vite.config.ts` | Add dev server proxy for `/api` → `http://localhost:3001` |
| `package.json` | Add `concurrently` dev dep, add `dev:server` and `dev:all` scripts |

## New Files to Create

### Frontend

| File | Purpose |
|------|---------|
| `src/views/ai-editor/index.vue` | New main editor layout wrapped in `<WebCutProvider>` |
| `src/views/ai-editor/upload-zone.vue` | Drag-and-drop video upload + target language dropdown |
| `src/views/ai-editor/ai-status-panel.vue` | Pipeline progress display (stages, progress bars, track list) |
| `src/services/ai-client.ts` | HTTP client — upload video, SSE listener with reconnect, download audio as Blob |
| `src/hooks/ai-pipeline.ts` | Composable: dual video path, explicit rail IDs, blob→File conversion, timeline population |

### Backend

| File | Purpose |
|------|---------|
| `server/package.json` | Express server dependencies |
| `server/tsconfig.json` | TypeScript config for server |
| `server/.env.example` | Template for API keys (.env gitignored) |
| `server/.gitignore` | Ignore .env, node_modules/, data/ |
| `server/src/index.ts` | Express app entry with CORS |
| `server/src/routes/analyze.ts` | Video upload + job creation, triggers pipeline in background |
| `server/src/routes/status.ts` | SSE progress streaming with event replay on reconnect |
| `server/src/routes/audio.ts` | Serve generated audio files with CORS + Content-Type headers |
| `server/src/routes/cancel.ts` | Abort running pipeline, clean up temp files |
| `server/src/services/gemini.ts` | Gemini scene analysis + transcription + translation |
| `server/src/services/elevenlabs.ts` | ElevenLabs generation with built-in exponential backoff retry |
| `server/src/services/pipeline.ts` | Orchestration: analysis → parallel generation (music+SFX+ambience) → dubbing |
| `server/src/services/video-utils.ts` | ffmpeg frame extraction with adaptive sampling + audio extraction |
| `server/src/services/job-store.ts` | Job state persistence to disk + TTL cleanup + auto-create data/jobs/ dir |
| `server/src/types.ts` | Shared TypeScript interfaces for API contracts |

---

## Implementation Order

| Step | Description | Status |
|------|-------------|--------|
| 0 | Project setup — Save plan as plan.md in project root | |
| 1 | Backend skeleton — Express server, routes, types, env setup, job-store, CORS | |
| 2 | Video utils — ffmpeg frame extraction with adaptive sampling, audio extraction | |
| 3 | Gemini integration — Scene analysis with frame cap + File API upload | |
| 4 | ElevenLabs integration — All four generation functions with retry/backoff | |
| 5 | Pipeline orchestration — Wire analysis → parallel generation → dubbing | |
| 6 | Frontend UI — AiEditor with `<WebCutProvider>`, upload zone with language dropdown, status panel | |
| 7 | AI client — HTTP client + SSE with reconnect + Blob download | |
| 8 | Pipeline composable — Dual video path, pre-created rails, blob→File, timeline population, video audio muting | |
| 9 | Config — Vite proxy, package.json scripts, dev:all | |
| 10 | Polish — Loading states, error toasts, export flow verification | |

---

## Verification

1. **Backend:** `cd server && pnpm tsx src/index.ts` — server starts on port 3001, accepts POST to /api/analyze
2. **Frontend:** `pnpm dev` — opens browser, shows upload zone with language dropdown instead of full editor
3. **Integration test:** Upload a short video (10-15 seconds), verify:
   - Video loads in player immediately while upload proceeds to backend
   - Progress updates stream via SSE in the status panel
   - Audio files appear on timeline as 4 separate, named rails (Music, SFX, Ambience, Dialogue)
   - Playback plays the video with all generated audio layers
   - Export produces an MP4 with mixed audio
4. **Dubbing test:** Upload video with speech, select target language, verify:
   - Original video audio is muted/reduced
   - Dubbed audio appears on Dialogue rail matching original speech timing
5. **Resilience test:**
   - Refresh browser mid-pipeline — SSE reconnects and catches up
   - Restart server mid-job — job state restored from disk
   - Send rapid requests — ElevenLabs retry handles 429s gracefully
   - Cancel mid-pipeline — job aborted, temp files cleaned up
