# QZ Live — GitHub + Vercel + Render

The frontend lives in this directory and is built with Vite + React. The API and realtime gateway live in `backend/` and run on Render. PostgreSQL persists live rooms.

## Vercel frontend
- Vercel project root directory: `qz-live`
- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_API_URL=https://YOUR-RENDER-WEB-SERVICE.onrender.com`

## Render backend
- Runtime: Node
- Root directory: `qz-live/backend`
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/api/_healthcheck`
- Environment variables: `DATABASE_URL` (Render PostgreSQL connection string), `FRONTEND_ORIGIN` (Vercel app URL).

The server creates the `qz_rooms` table on startup. The API has an in-memory fallback for local development, but production should set `DATABASE_URL` so room state survives restarts.

## Gameplay preserved
- Six-digit room PINs and shareable invite links
- Live player updates and leaderboards
- Editable question set and per-question timer
- Speed-based scoring and final 2× Clutch Round
