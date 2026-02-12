# chatpro

[![CI](https://github.com/jiangmuran/chatpro/actions/workflows/ci.yml/badge.svg)](https://github.com/jiangmuran/chatpro/actions/workflows/ci.yml)

chatpro is a roleplay-first AI chat platform with a clean, content-forward UI and an admin console for operations.

## Highlights

- Roleplay-first conversation flow with persona selection
- Streaming responses with auto-scroll and retry handling
- Markdown rendering with code copy
- Admin console for metrics, logs, users, personas, and system settings

## Structure

- `apps/web` — end-user chat UI (React + Vite)
- `apps/admin` — admin console (React + Vite)
- `server` — API + web/admin static hosting (Express)
- `packages/shared` — shared types

## Local Development

Install dependencies:

```bash
npm install
```

Run services:

```bash
npm run dev:server
npm run dev:web
npm run dev:admin
```

Default ports:

- Web: `http://localhost:5174`
- Admin: `http://localhost:5174/admin`
- API: `http://localhost:5178`

## Environment Variables

Create a `.env` at the repo root or in production at `/opt/chatpro/.env`:

```ini
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com
ADMIN_USER=admin
ADMIN_PASSWORD=admin
DEFAULT_QUOTA_ENHANCED=10
DEFAULT_QUOTA_PRO=5
MODEL_NORMAL=gpt-4o-mini
MODEL_ENHANCED=gpt-4o
MODEL_PRO=gpt-4.1
```

## Build

```bash
npm run build -ws
```

## Production

The server serves both the web and admin builds:

- Web: `/`
- Admin: `/admin`

Start the server:

```bash
node server/index.js
```
