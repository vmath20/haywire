# Haywire

Turn any GitHub repository into an interactive knowledge graph.

**Live:** [haywire-omega.vercel.app](https://haywire-omega.vercel.app)  
**Source:** [github.com/vmath20/haywire](https://github.com/vmath20/haywire)

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

## Deploy (Vercel)

This repo deploys as a single Vercel project with two [Services](https://vercel.com/docs/services):

| Service | Runtime | Route |
|---------|---------|--------|
| `web` | Next.js | `/` |
| `api` | Docker (FastAPI) | `/api/backend/*` |

```bash
npx vercel --prod
```

GitHub integration is connected for `vmath20/haywire` — pushes to `main` can trigger production deploys.

## API

| Endpoint | Purpose |
|----------|---------|
| `POST /analyze` | Start a job `{ url, force?, code_only? }` |
| `GET /jobs/{id}` | Poll status |
| `GET /graph/{owner}/{repo}` | Cached graph |
| `GET /health` | Health check |

Public URLs are prefixed with `/api/backend` on Vercel (e.g. `/api/backend/health`).

## Project layout

```
├── src/                 # Next.js App Router UI
├── backend/             # FastAPI + AST extractor (Docker)
│   ├── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── vercel.json          # Vercel Services config
└── LICENSE              # MIT
```

## Contributing

Issues and PRs welcome. Keep the UI lean; prefer small, focused changes.

## License

MIT
