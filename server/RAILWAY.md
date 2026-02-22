# Deploy AI Sound Design server to Railway

## 1. One-time setup

1. Go to [railway.app](https://railway.app) and sign in (GitHub is easiest).
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select your repo. If the repo has both frontend and this server, you’ll set the **root directory** in the next step.

## 2. Configure the service

1. After the project is created, open the service (or add a service and connect the same repo).
2. Go to **Settings** → **Source**:
   - Set **Root Directory** to **`server`** (the folder that contains `package.json` and this RAILWAY.md — **not** `server/src`). Railway will run `pnpm install` and `pnpm start` from that folder.
3. **Build**: Railway will run `pnpm install` (or `npm install`) in `server/`. No extra build command needed.
4. **Start**: Railway uses `pnpm start` / `npm start`, which runs `tsx src/index.ts`. The `nixpacks.toml` in this folder installs **ffmpeg** for the build.

## 3. Environment variables

In the Railway service, go to **Variables** and add:

| Variable              | Required | Description |
|-----------------------|----------|-------------|
| `GEMINI_API_KEY`      | Yes      | Google AI (Gemini) API key for video analysis. |
| `ELEVENLABS_API_KEY`  | Yes      | ElevenLabs API key for audio generation. |
| `OPENAI_API_KEY`      | No       | OpenAI API key for prompt rewriting (optional). |

Railway sets `PORT` automatically; the server already uses `process.env.PORT || 3001`.

## 4. Deploy

- Push to your connected branch; Railway deploys on push.
- Or trigger a deploy from the Railway dashboard.

## 5. Get the public URL

1. In the service, go to **Settings** → **Networking** → **Generate Domain** (or use the default one).
2. Copy the URL (e.g. `https://webcut-ai-server-production-xxxx.up.railway.app`).

## 6. Point the frontend (Vercel) to this backend

1. In **Vercel** → your frontend project → **Settings** → **Environment Variables**.
2. Add:
   - **Name:** `VITE_API_BASE`
   - **Value:** your Railway URL, e.g. `https://webcut-ai-server-production-xxxx.up.railway.app` (no trailing slash).
3. Redeploy the frontend so the new variable is applied.

The app will then call this Railway server for AI sound design instead of `/api` on Vercel.
