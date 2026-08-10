# Haywire

Turn any GitHub repository into an interactive knowledge graph.

Paste a GitHub URL → Haywire clones the repo → parses code with **tree-sitter AST** (deterministic, no LLM for code) → renders a force-directed graph with communities, hub nodes, and EXTRACTED / INFERRED edges.

## Features

- Paste `owner/repo` or a full GitHub URL
- Force-directed knowledge graph with community colors
- Hub nodes, EXTRACTED / INFERRED edge filters, search, and report view
- Local-first code extraction (AST / tree-sitter)

## Quick start (local)

### Prerequisites

- Node.js 20+
- Python 3.10+
- Git

### Backend

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

### Frontend

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — try `/karpathy/nanoGPT`.

Or run both with `./start.sh`.

## Deploy

Haywire is two services:

| Piece | Suggested host | Why |
|-------|----------------|-----|
| Next.js UI | **Vercel** | Static + SSR frontend |
| FastAPI graph builder | **Fly.io / Railway / Render** (Docker) | Needs git clone, filesystem, and long-running AST extract |

### 1. Backend (Docker)

```bash
cd backend
docker build -t haywire-api .
docker run -p 8000:8000 -e HAYWIRE_CORS_ORIGINS=https://YOUR_APP.vercel.app haywire-api
```

Set on the host:

- `HAYWIRE_CORS_ORIGINS` — your Vercel URL(s), comma-separated
- `HAYWIRE_CORS_ORIGIN_REGEX` — optional; defaults to `https://.*\.vercel\.app`
- `HAYWIRE_DATA` — persistent volume path for graph cache (default `/data`)

### 2. Frontend (Vercel)

```bash
npx vercel --prod
```

In the Vercel project settings, add:

| Variable | Value |
|----------|--------|
| `HAYWIRE_API_URL` | `https://your-api-host` (no trailing slash) |

Vercel rewrites `/api/backend/*` → that API. Leave unset only for local dev against `http://127.0.0.1:8000`.

## API

| Endpoint | Purpose |
|----------|---------|
| `POST /analyze` | Start a job `{ url, force?, code_only? }` |
| `GET /jobs/{id}` | Poll status |
| `GET /graph/{owner}/{repo}` | Cached graph |
| `GET /health` | Health check |

## Project layout

```
├── src/                 # Next.js App Router UI
├── backend/             # FastAPI + AST extractor
│   ├── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── vercel.json
└── LICENSE              # MIT
```

## Contributing

Issues and PRs welcome. Keep the UI lean; prefer small, focused changes.

## License

MIT
