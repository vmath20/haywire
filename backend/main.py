"""Haywire backend — clone a GitHub repo and build a knowledge graph."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
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
BUILD_LOCK = threading.Lock()
# In-memory graph results so /graph and /jobs/{id}/graph work even if disk is flaky.
# (Still per-instance — clients should prefer /jobs/{id}/graph right after build.)
MEMORY_GRAPHS: dict[str, dict[str, Any]] = {}

GITHUB_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/"
    r"(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+?)(?:\.git)?/?$"
)
OWNER_REPO_RE = re.compile(r"^(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+)$")

MAX_CLONE_DEPTH = 1
EXTRACT_TIMEOUT = int(os.environ.get("HAYWIRE_EXTRACT_TIMEOUT", "600"))

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


class QueryRequest(BaseModel):
    owner: str
    repo: str
    question: str = Field(..., min_length=2, max_length=2000)
    budget: int = Field(default=2000, ge=200, le=8000)
    dfs: bool = False
    """Optional HTTPS URL to a graph JSON blob (e.g. Convex storage) when API cache misses."""
    graph_url: str | None = None


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
    key = cache_key(owner, repo)
    with JOBS_LOCK:
        mem = MEMORY_GRAPHS.get(key)
        if mem:
            return {**mem, "cached": True}

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
    payload = {
        "owner": owner,
        "repo": repo,
        "cached": True,
        "graph": graph,
        "summary": summarize_graph(graph, report),
        "report": report,
        "meta": meta,
    }
    with JOBS_LOCK:
        MEMORY_GRAPHS[key] = payload
    return payload


def remember_graph(job_id: str, payload: dict[str, Any]) -> None:
    key = cache_key(str(payload["owner"]), str(payload["repo"]))
    with JOBS_LOCK:
        MEMORY_GRAPHS[key] = payload
        job = JOBS.get(job_id)
        if job is not None:
            job["full"] = payload


def build_graph(job_id: str, owner: str, repo: str, force: bool, code_only: bool) -> None:
    with BUILD_LOCK:
        _build_graph_locked(job_id, owner, repo, force, code_only)


def _build_graph_locked(job_id: str, owner: str, repo: str, force: bool, code_only: bool) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        REPOS_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

        if not force:
            cached = load_cached(owner, repo)
            if cached:
                emit(job_id, "status", {"message": "Loaded cached graph", "stage": "cache"})
                remember_graph(job_id, {**cached, "cached": True})
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
            shutil.rmtree(dest, ignore_errors=True)
        dest.parent.mkdir(parents=True, exist_ok=True)

        try:
            run_cmd([*extractor, "clone", github_url, "--out", str(dest)], timeout=120)
        except Exception:
            if dest.exists():
                shutil.rmtree(dest, ignore_errors=True)
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

        # Free disk ASAP — keep only the compact cache, not the full clone.
        try:
            if dest.exists():
                shutil.rmtree(dest)
        except Exception:
            pass

        summary = summarize_graph(graph, report)
        full = {
            "owner": owner,
            "repo": repo,
            "cached": False,
            "graph": graph,
            "summary": summary,
            "report": report,
            "meta": meta,
        }
        remember_graph(job_id, full)

        emit(
            job_id,
            "done",
            {
                "owner": owner,
                "repo": repo,
                "cached": False,
                "summary": summary,
                "meta": meta,
            },
        )
    except subprocess.TimeoutExpired:
        try:
            dest = repo_path(owner, repo)
            if dest.exists():
                shutil.rmtree(dest)
        except Exception:
            pass
        emit(job_id, "error", {"message": "Timed out while building the graph. Try a smaller repository."})
    except Exception as exc:
        try:
            dest = repo_path(owner, repo)
            if dest.exists():
                shutil.rmtree(dest)
        except Exception:
            pass
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
            # Multi-instance: this replica may not own the job — keep polling.
            return {
                "job_id": job_id,
                "status": "pending",
                "events": [],
                "result": None,
                "error": None,
            }
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
            result["has_graph"] = bool(job.get("full"))
        if job["status"] == "error" and job["result"]:
            error = {"message": sanitize_text(str(job["result"].get("message", "error")), 2000)}
        return {
            "job_id": job_id,
            "status": job["status"],
            "events": slim_events,
            "result": result,
            "error": error,
        }


@app.get("/jobs/{job_id}/graph")
def job_graph(job_id: str) -> dict[str, Any]:
    """Full AnalyzeResult for a completed job (same replica that built it)."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job or job["status"] != "done" or not job.get("full"):
            raise HTTPException(404, "Graph not available on this instance yet")
        return job["full"]


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
        {"owner": "openclaw", "repo": "openclaw", "label": "OpenClaw"},
        {"owner": "mermaid-js", "repo": "mermaid", "label": "Mermaid"},
        {"owner": "karpathy", "repo": "nanochat", "label": "nanochat"},
        {"owner": "agent0ai", "repo": "agent-zero", "label": "Agent Zero"},
        {"owner": "langchain-ai", "repo": "langchain", "label": "LangChain"},
    ]


ALLOWED_GRAPH_URL_HOSTS = (
    "convex.cloud",
    "haywire-omega.vercel.app",
)


def _allowed_graph_url(url: str) -> bool:
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        if parsed.scheme != "https":
            return False
        host = (parsed.hostname or "").lower()
        return any(host == h or host.endswith("." + h) for h in ALLOWED_GRAPH_URL_HOSTS)
    except Exception:
        return False


def _knowledge_graph_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize AnalyzeResult or raw graphify JSON into a node-link graph dict."""
    nested = payload.get("graph")
    if (
        isinstance(nested, dict)
        and isinstance(nested.get("nodes"), list)
        and "summary" in payload
    ):
        return nested
    if isinstance(payload.get("nodes"), list) and isinstance(payload.get("links"), list):
        return payload
    raise ValueError("Unrecognized graph payload")


def _materialize_graph_file(owner: str, repo: str, graph_url: str | None) -> tuple[Path, bool]:
    """
    Return (path_to_graph.json, is_temporary).
    Prefers on-disk API cache, then in-memory build, then optional remote URL.
    """
    cached = cache_path(owner, repo) / "graph.json"
    if cached.exists():
        return cached, False

    key = cache_key(owner, repo)
    with JOBS_LOCK:
        mem = MEMORY_GRAPHS.get(key)
    if mem:
        try:
            kg = _knowledge_graph_from_payload(mem)
        except ValueError:
            kg = None
        if kg:
            tmp = Path(tempfile.mkdtemp(prefix="haywire-query-")) / "graph.json"
            tmp.write_text(json.dumps(kg), encoding="utf-8")
            return tmp, True

    if graph_url:
        if not _allowed_graph_url(graph_url):
            raise HTTPException(400, "graph_url host is not allowed")
        try:
            req = urllib.request.Request(
                graph_url,
                headers={"User-Agent": "haywire-query/1.0"},
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw_bytes = resp.read()
            payload = json.loads(raw_bytes.decode("utf-8"))
            kg = _knowledge_graph_from_payload(payload)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, f"Could not load graph_url: {sanitize_text(str(exc), 300)}") from exc

        tmp = Path(tempfile.mkdtemp(prefix="haywire-query-")) / "graph.json"
        tmp.write_text(json.dumps(kg), encoding="utf-8")
        return tmp, True

    raise HTTPException(
        404,
        "No graph available for this repository. Open it from Graphs first, or pick an example.",
    )


def _run_graphify_query(
    graph_file: Path, question: str, *, dfs: bool, budget: int
) -> tuple[str, dict[str, Any]]:
    """Run graphify traversal; return (text_context, structured_traversal)."""
    try:
        from networkx.readwrite import json_graph
        from graphify.serve import (
            _bfs,
            _dfs,
            _filter_graph_by_context,
            _pick_seeds,
            _query_terms,
            _RELATIONAL_INTENT_TERMS,
            _resolve_context_filters,
            _score_query,
            _subgraph_to_text,
        )
    except ImportError as exc:
        extractor = find_extractor()
        cmd = [*extractor, "query", question, "--graph", str(graph_file), "--budget", str(budget)]
        if dfs:
            cmd.append("--dfs")
        try:
            return run_cmd(cmd, timeout=120), {
                "mode": "dfs" if dfs else "bfs",
                "seeds": [],
                "visit_order": [],
                "edges": [],
            }
        except Exception as cli_exc:
            raise RuntimeError(f"graphify query unavailable: {exc}; cli: {cli_exc}") from cli_exc

    raw = json.loads(graph_file.read_text(encoding="utf-8"))
    if "links" not in raw and "edges" in raw:
        raw = dict(raw, links=raw["edges"])
    raw = dict(
        raw,
        links=[
            {
                **link,
                "_src": link.get("_src", link.get("source")),
                "_tgt": link.get("_tgt", link.get("target")),
            }
            for link in raw.get("links", [])
        ],
    )
    try:
        G = json_graph.node_link_graph(raw, edges="links")
    except TypeError:
        G = json_graph.node_link_graph(raw)

    mode = "dfs" if dfs else "bfs"
    depth = 2
    terms = _query_terms(question)
    qs = _score_query(G, terms, collect_per_term_seeds=True)
    best_seed_by_term = qs.best_seed_by_term
    intent = {t for t in best_seed_by_term if t in _RELATIONAL_INTENT_TERMS}
    if intent and any(t not in _RELATIONAL_INTENT_TERMS for t in terms):
        best_seed_by_term = {
            t: nid for t, nid in best_seed_by_term.items() if t not in intent
        }
    start_nodes = _pick_seeds(qs.ranked, G=G, best_seed_by_term=best_seed_by_term)
    overview_fallback = False
    if not start_nodes:
        # Broad or follow-up questions ("how are the models processed?") often
        # match no symbol names. Instead of returning empty evidence, seed the
        # traversal from the most-connected nodes so the answer is grounded in
        # the repo's actual core structure.
        overview_fallback = True
        try:
            ranked_by_degree = sorted(G.degree, key=lambda kv: kv[1], reverse=True)
            start_nodes = [nid for nid, _ in ranked_by_degree[:5]]
        except Exception:
            start_nodes = list(G.nodes)[:5]
    if not start_nodes:
        return "No matching nodes found.", {
            "mode": mode,
            "seeds": [],
            "visit_order": [],
            "edges": [],
        }

    resolved_filters, filter_source = _resolve_context_filters(question, None)
    traversal_graph = _filter_graph_by_context(G, resolved_filters)
    nodes, edges = (
        _dfs(traversal_graph, start_nodes, depth)
        if mode == "dfs"
        else _bfs(traversal_graph, start_nodes, depth)
    )

    header_parts = [
        f"Traversal: {mode.upper()} depth={depth}",
        f"Start: {[G.nodes[n].get('label', n) for n in start_nodes]}",
    ]
    if overview_fallback:
        header_parts.append(
            "Note: question matched no symbol names; showing the repo's most-connected components instead"
        )
    if resolved_filters:
        header_parts.append(f"Context: {', '.join(resolved_filters)} ({filter_source})")
    header_parts.append(f"{len(nodes)} nodes found")
    header = " | ".join(header_parts) + "\n\n"
    text = header + _subgraph_to_text(
        traversal_graph, nodes, edges, budget, seeds=start_nodes
    )

    # Reconstruct a stable visit order: seeds first, then edge-discovery order.
    visit_ids: list[str] = []
    seen: set[str] = set()
    for nid in start_nodes:
        if nid in nodes and nid not in seen:
            visit_ids.append(nid)
            seen.add(nid)
    for edge in edges:
        if not isinstance(edge, (tuple, list)) or len(edge) < 2:
            continue
        src, tgt = str(edge[0]), str(edge[1])
        for nid in (src, tgt):
            if nid in nodes and nid not in seen:
                visit_ids.append(nid)
                seen.add(nid)
    for nid in nodes:
        sid = str(nid)
        if sid not in seen:
            visit_ids.append(sid)
            seen.add(sid)

    # Cap payload size for the replay UI / Convex storage.
    max_steps = 120
    visit_ids = visit_ids[:max_steps]
    visit_set = set(visit_ids)
    seed_set = {str(s) for s in start_nodes}

    # Approximate depth via BFS layers from seeds on the traversed edge list.
    depth_map: dict[str, int] = {s: 0 for s in start_nodes if str(s) in visit_set}
    frontier = [s for s in start_nodes if str(s) in visit_set]
    hop = 0
    adj: dict[str, list[str]] = {}
    edge_payload: list[dict[str, str]] = []
    for edge in edges:
        if not isinstance(edge, (tuple, list)) or len(edge) < 2:
            continue
        a, b = str(edge[0]), str(edge[1])
        if a not in visit_set or b not in visit_set:
            continue
        edge_payload.append({"from": a, "to": b})
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    while frontier and hop < depth + 2:
        hop += 1
        nxt: list[str] = []
        for n in frontier:
            for nb in adj.get(str(n), []):
                if nb not in depth_map:
                    depth_map[nb] = hop
                    nxt.append(nb)
        frontier = nxt

    visit_order: list[dict[str, Any]] = []
    for nid in visit_ids:
        data = G.nodes.get(nid, {}) if nid in G.nodes else {}
        visit_order.append(
            {
                "id": nid,
                "label": sanitize_text(str(data.get("label") or nid), 120),
                "depth": int(depth_map.get(nid, 0)),
                "seed": nid in seed_set,
                "source_file": sanitize_text(str(data.get("source_file") or ""), 240) or None,
            }
        )

    traversal = {
        "mode": mode,
        "depth": depth,
        "seeds": [str(s) for s in start_nodes],
        "visit_order": visit_order,
        "edges": edge_payload[: max_steps * 3],
        "node_count": len(nodes),
        "context_filters": resolved_filters or [],
    }
    return text, traversal


@app.post("/query")
def query_graph(req: QueryRequest) -> dict[str, Any]:
    owner = req.owner.strip()
    repo = req.repo.strip()
    question = req.question.strip()
    if not owner or not repo:
        raise HTTPException(400, "owner and repo are required")
    if not question:
        raise HTTPException(400, "question is required")

    graph_file: Path | None = None
    temporary = False
    try:
        graph_file, temporary = _materialize_graph_file(owner, repo, req.graph_url)
        started = time.time()
        answer, traversal = _run_graphify_query(
            graph_file,
            question,
            dfs=req.dfs,
            budget=req.budget,
        )
        elapsed_ms = int((time.time() - started) * 1000)
        graph_context = sanitize_text(answer)
        return {
            "owner": owner,
            "repo": repo,
            "question": question,
            # Raw graphify traversal (also exposed as answer for older clients).
            "graph_context": graph_context,
            "answer": graph_context,
            "traversal": traversal,
            "mode": "dfs" if req.dfs else "bfs",
            "budget": req.budget,
            "elapsed_ms": elapsed_ms,
            "llm_used": False,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, sanitize_text(str(exc), 800)) from exc
    finally:
        if temporary and graph_file is not None:
            try:
                shutil.rmtree(graph_file.parent, ignore_errors=True)
            except Exception:
                pass


@app.post("/admin/cleanup")
def cleanup_disk() -> dict[str, Any]:
    """Remove cloned repos (and optionally all caches) to free container disk."""
    removed_repos = 0
    if REPOS_DIR.exists():
        for child in list(REPOS_DIR.iterdir()):
            try:
                if child.is_dir():
                    shutil.rmtree(child)
                    removed_repos += 1
                else:
                    child.unlink()
                    removed_repos += 1
            except Exception:
                pass
    return {"ok": True, "removed_repo_trees": removed_repos}
