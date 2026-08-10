"""Haywire backend — clone a GitHub repo and build a knowledge graph."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Iterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

APP_ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("HAYWIRE_DATA", APP_ROOT / ".data"))
REPOS_DIR = DATA_DIR / "repos"
CACHE_DIR = DATA_DIR / "cache"
JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()

GITHUB_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/"
    r"(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+?)(?:\.git)?/?$"
)
OWNER_REPO_RE = re.compile(r"^(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+)$")

MAX_CLONE_DEPTH = 1
EXTRACT_TIMEOUT = int(os.environ.get("HAYWIRE_EXTRACT_TIMEOUT", "300"))

app = FastAPI(title="Haywire", version="1.0.0")


@app.middleware("http")
async def strip_api_backend_prefix(request, call_next):
    """Vercel services keep the public path (/api/backend/...); local rewrites strip it."""
    path = request.scope.get("path", "")
    prefix = "/api/backend"
    if path == prefix or path.startswith(prefix + "/"):
        new_path = path[len(prefix) :] or "/"
        request.scope["path"] = new_path
    return await call_next(request)


# Allow browser calls from the Vercel frontend (and local dev).
_cors_origins = [
    o.strip()
    for o in os.environ.get(
        "HAYWIRE_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins if "*" not in _cors_origins else ["*"],
    allow_origin_regex=os.environ.get(
        "HAYWIRE_CORS_ORIGIN_REGEX",
        r"https://.*\.vercel\.app",
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    url: str = Field(..., description="GitHub URL or owner/repo")
    force: bool = False
    code_only: bool = True


def parse_github(url: str) -> tuple[str, str]:
    raw = url.strip().rstrip("/")
    if raw.startswith("http://") or raw.startswith("https://") or "github.com/" in raw:
        m = GITHUB_RE.match(raw)
        if not m:
            raise HTTPException(400, "Invalid GitHub URL. Expected https://github.com/owner/repo")
        return m.group("owner"), m.group("repo").removesuffix(".git")
    m = OWNER_REPO_RE.match(raw)
    if not m:
        raise HTTPException(400, "Invalid repository. Use owner/repo or a full GitHub URL.")
    return m.group("owner"), m.group("repo")


def cache_key(owner: str, repo: str) -> str:
    return f"{owner}__{repo}".lower()


def cache_path(owner: str, repo: str) -> Path:
    return CACHE_DIR / cache_key(owner, repo)


def repo_path(owner: str, repo: str) -> Path:
    return REPOS_DIR / owner.lower() / repo.lower()


def emit(job_id: str, event: str, data: dict[str, Any]) -> None:
    with JOBS_LOCK:
        job = JOBS.setdefault(job_id, {"events": [], "status": "running", "result": None})
        payload = {"event": event, **data, "ts": time.time()}
        job["events"].append(payload)
        if event in {"done", "error"}:
            job["status"] = event
            job["result"] = data


def run_cmd(cmd: list[str], cwd: Path | None = None, timeout: int = EXTRACT_TIMEOUT) -> str:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=timeout,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "command failed").strip()
        raise RuntimeError(err[-2000:])
    return (proc.stdout or "").strip()


def find_extractor() -> list[str]:
    """Resolve the installed AST knowledge-graph CLI."""
    which = shutil.which("graphify")
    if which:
        return [which]
    return ["python3", "-m", "graphify"]


def sanitize_text(value: str | None, limit: int | None = None) -> str:
    """Strip ASCII control chars and scrub third-party tool names from reports."""
    if not value:
        return ""
    cleaned = "".join(ch if ord(ch) >= 32 or ch in "\n\t\r" else " " for ch in value)
    # Neutralize tool-branded phrasing that may appear in generated reports
    replacements = (
        (re.compile(r"(?i)graphify[_-]?out"), "haywire-out"),
        (re.compile(r"(?i)\bgraphifyy?\b"), "haywire"),
        (re.compile(r"(?i)\bgitdiagram\b"), "haywire"),
        (re.compile(r"(?i)# Graph Report"), "# Haywire Report"),
    )
    for pattern, repl in replacements:
        cleaned = pattern.sub(repl, cleaned)
    if limit is not None:
        return cleaned[:limit]
    return cleaned


def summarize_graph(graph: dict[str, Any], report_md: str | None = None) -> dict[str, Any]:
    nodes = graph.get("nodes", [])
    links = graph.get("links", [])
    communities: dict[int, int] = {}
    confidence = {"EXTRACTED": 0, "INFERRED": 0, "AMBIGUOUS": 0}
    for n in nodes:
        c = n.get("community", 0)
        communities[c] = communities.get(c, 0) + 1
    for e in links:
        conf = str(e.get("confidence", "EXTRACTED")).upper()
        if conf not in confidence:
            confidence[conf] = 0
        confidence[conf] += 1

    degree: dict[str, int] = {}
    for e in links:
        degree[e.get("source", "")] = degree.get(e.get("source", ""), 0) + 1
        degree[e.get("target", "")] = degree.get(e.get("target", ""), 0) + 1
    id_to_label = {n.get("id"): n.get("label", n.get("id")) for n in nodes}
    gods = sorted(degree.items(), key=lambda x: x[1], reverse=True)[:8]
    god_nodes = [
        {"id": nid, "label": id_to_label.get(nid, nid), "degree": deg}
        for nid, deg in gods
        if nid
    ]

    return {
        "node_count": len(nodes),
        "edge_count": len(links),
        "community_count": len(communities),
        "confidence": confidence,
        "god_nodes": god_nodes,
        "report_excerpt": sanitize_text(report_md, 4000),
    }


def load_cached(owner: str, repo: str) -> dict[str, Any] | None:
    base = cache_path(owner, repo)
    graph_file = base / "graph.json"
    if not graph_file.exists():
        return None
    graph = json.loads(graph_file.read_text(encoding="utf-8"))
    report_path = base / "GRAPH_REPORT.md"
    report = (
        sanitize_text(report_path.read_text(encoding="utf-8", errors="replace"))
        if report_path.exists()
        else None
    )
    meta_file = base / "meta.json"
    meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
    return {
        "owner": owner,
        "repo": repo,
        "cached": True,
        "graph": graph,
        "summary": summarize_graph(graph, report),
        "report": report,
        "meta": meta,
    }


def build_graph(job_id: str, owner: str, repo: str, force: bool, code_only: bool) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        REPOS_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

        if not force:
            cached = load_cached(owner, repo)
            if cached:
                emit(job_id, "status", {"message": "Loaded cached graph", "stage": "cache"})
                emit(
                    job_id,
                    "done",
                    {
                        "owner": owner,
                        "repo": repo,
                        "cached": True,
                        "summary": cached["summary"],
                        "meta": cached.get("meta") or {},
                    },
                )
                return

        dest = repo_path(owner, repo)
        github_url = f"https://github.com/{owner}/{repo}.git"
        extractor = find_extractor()

        emit(job_id, "status", {"message": f"Cloning {owner}/{repo}…", "stage": "clone"})
        if dest.exists():
            shutil.rmtree(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)

        try:
            run_cmd([*extractor, "clone", github_url, "--out", str(dest)], timeout=120)
        except Exception:
            run_cmd(
                [
                    "git",
                    "clone",
                    "--depth",
                    str(MAX_CLONE_DEPTH),
                    "--single-branch",
                    github_url,
                    str(dest),
                ],
                timeout=120,
            )

        emit(
            job_id,
            "status",
            {
                "message": "Extracting AST knowledge graph (tree-sitter, no LLM)…",
                "stage": "extract",
            },
        )
        extract_cmd = [*extractor, "extract", str(dest), "--force"]
        if code_only:
            extract_cmd.append("--code-only")
        run_cmd(extract_cmd, cwd=dest, timeout=EXTRACT_TIMEOUT)

        emit(job_id, "status", {"message": "Detecting communities…", "stage": "cluster"})
        try:
            run_cmd(
                [*extractor, "cluster-only", str(dest), "--no-label"],
                cwd=dest,
                timeout=120,
            )
        except Exception as cluster_err:
            emit(
                job_id,
                "status",
                {
                    "message": f"Clustering skipped: {cluster_err}",
                    "stage": "cluster_warn",
                },
            )

        out = dest / "graphify-out"
        graph_file = out / "graph.json"
        if not graph_file.exists():
            raise RuntimeError("Extractor did not produce graph.json")

        graph = json.loads(graph_file.read_text())
        report_raw = (
            (out / "GRAPH_REPORT.md").read_text(encoding="utf-8", errors="replace")
            if (out / "GRAPH_REPORT.md").exists()
            else None
        )
        report = sanitize_text(report_raw) if report_raw else None

        cache = cache_path(owner, repo)
        if cache.exists():
            shutil.rmtree(cache)
        cache.mkdir(parents=True)
        shutil.copy2(graph_file, cache / "graph.json")
        if report:
            (cache / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
        meta = {
            "owner": owner,
            "repo": repo,
            "built_at": time.time(),
            "code_only": code_only,
            "commit": graph.get("built_at_commit"),
        }
        (cache / "meta.json").write_text(json.dumps(meta, indent=2))

        emit(
            job_id,
            "done",
            {
                "owner": owner,
                "repo": repo,
                "cached": False,
                "summary": summarize_graph(graph, report),
                "meta": meta,
            },
        )
    except subprocess.TimeoutExpired:
        emit(job_id, "error", {"message": "Timed out while building the graph. Try a smaller repository."})
    except Exception as exc:
        emit(job_id, "error", {"message": sanitize_text(str(exc), 2000)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, str]:
    owner, repo = parse_github(req.url)
    job_id = str(uuid.uuid4())
    with JOBS_LOCK:
        JOBS[job_id] = {"events": [], "status": "queued", "result": None}
    thread = threading.Thread(
        target=build_graph,
        args=(job_id, owner, repo, req.force, req.code_only),
        daemon=True,
    )
    thread.start()
    return {"job_id": job_id, "owner": owner, "repo": repo}


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        slim_events = [
            {
                "event": ev.get("event"),
                "message": sanitize_text(str(ev.get("message", "")), 500),
                "stage": ev.get("stage"),
                "ts": ev.get("ts"),
            }
            for ev in job["events"]
            if ev.get("event") == "status"
        ]
        result = None
        error = None
        if job["status"] == "done" and job["result"]:
            result = {
                k: job["result"][k]
                for k in ("owner", "repo", "cached", "summary", "meta")
                if k in job["result"]
            }
        if job["status"] == "error" and job["result"]:
            error = {"message": sanitize_text(str(job["result"].get("message", "error")), 2000)}
        return {
            "job_id": job_id,
            "status": job["status"],
            "events": slim_events,
            "result": result,
            "error": error,
        }


@app.get("/jobs/{job_id}/stream")
def job_stream(job_id: str) -> StreamingResponse:
    def gen() -> Iterator[str]:
        cursor = 0
        while True:
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    yield f"event: error\ndata: {json.dumps({'message': 'Job not found'})}\n\n"
                    return
                events = job["events"][cursor:]
                status = job["status"]
            for ev in events:
                cursor += 1
                safe = {
                    "event": ev.get("event"),
                    "message": sanitize_text(str(ev.get("message", "")), 500),
                    "stage": ev.get("stage"),
                    "ts": ev.get("ts"),
                }
                yield f"event: {safe['event']}\ndata: {json.dumps(safe)}\n\n"
            if status in {"done", "error"}:
                return
            time.sleep(0.4)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/graph/{owner}/{repo}")
def get_graph(owner: str, repo: str) -> dict[str, Any]:
    cached = load_cached(owner, repo)
    if not cached:
        raise HTTPException(404, "Graph not built yet. Submit the repository first.")
    return cached


@app.get("/examples")
def examples() -> list[dict[str, str]]:
    return [
        {"owner": "karpathy", "repo": "nanoGPT", "label": "nanoGPT"},
        {"owner": "pallets", "repo": "click", "label": "Click"},
        {"owner": "psf", "repo": "requests", "label": "Requests"},
        {"owner": "tiangolo", "repo": "fastapi", "label": "FastAPI"},
        {"owner": "pallets", "repo": "flask", "label": "Flask"},
    ]
