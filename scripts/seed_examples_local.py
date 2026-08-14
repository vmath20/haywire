#!/usr/bin/env python3
"""Build a Haywire AnalyzeResult locally and upload it into Convex exampleGraphs."""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED_DIR = Path(os.environ.get("HAYWIRE_SEED_DIR", "/tmp/haywire-seed"))
GRAPHIFY = os.environ.get("GRAPHIFY_BIN", shutil.which("graphify") or "graphify")


def run(cmd: list[str], cwd: Path | None = None, timeout: int = 3600) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True, timeout=timeout)


def convex_run(fn: str, args: dict | None = None) -> str:
    cmd = ["npx", "convex", "run", "--prod", fn]
    if args is not None:
        cmd.append(json.dumps(args))
    out = subprocess.check_output(cmd, cwd=str(ROOT), text=True)
    return out.strip()


def upload_blob(path: Path, content_type: str) -> str:
    url = convex_run("examples:generateUploadUrl").strip().strip('"')
    print(f"  uploading {path.name} ({path.stat().st_size} bytes) → {url[:60]}…", flush=True)
    res = subprocess.check_output(
        [
            "curl",
            "-sS",
            "-X",
            "POST",
            url,
            "-H",
            f"Content-Type: {content_type}",
            "--data-binary",
            f"@{path}",
        ],
        text=True,
    )
    data = json.loads(res)
    storage_id = data.get("storageId")
    if not storage_id:
        raise RuntimeError(f"upload failed: {res[:500]}")
    return storage_id


def summarize(graph: dict, report: str | None) -> dict:
    nodes = graph.get("nodes", [])
    links = graph.get("links", [])
    communities: dict[int, int] = {}
    confidence = {"EXTRACTED": 0, "INFERRED": 0, "AMBIGUOUS": 0}
    for n in nodes:
        c = n.get("community", 0)
        communities[c] = communities.get(c, 0) + 1
    for e in links:
        conf = str(e.get("confidence", "EXTRACTED")).upper()
        confidence[conf] = confidence.get(conf, 0) + 1
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
    excerpt = (report or "")[:4000]
    return {
        "node_count": len(nodes),
        "edge_count": len(links),
        "community_count": len(communities),
        "confidence": confidence,
        "god_nodes": god_nodes,
        "report_excerpt": excerpt,
    }


def svg_thumbnail(graph: dict) -> bytes:
    nodes = graph.get("nodes", [])[:120]
    id_set = {n["id"] for n in nodes if "id" in n}
    links = [
        e
        for e in graph.get("links", [])
        if e.get("source") in id_set and e.get("target") in id_set
    ][:220]
    w, h, cx, cy = 640, 360, 320, 180
    colors = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1"]
    by_c: dict[int, list] = {}
    for n in nodes:
        c = int(n.get("community") or 0)
        by_c.setdefault(c, []).append(n)
    cids = list(by_c.keys())
    pos: dict[str, tuple[float, float]] = {}
    for i, cid in enumerate(cids):
        members = by_c[cid]
        angle = (i / max(len(cids), 1)) * math.pi * 2
        gx = cx + math.cos(angle) * 110
        gy = cy + math.sin(angle) * 90
        r = 16 + min(50, len(members) * 2)
        for j, n in enumerate(members):
            a = (j / max(len(members), 1)) * math.pi * 2
            pos[n["id"]] = (gx + math.cos(a) * r, gy + math.sin(a) * r)
    edges = []
    for e in links:
        a, b = pos.get(e["source"]), pos.get(e["target"])
        if not a or not b:
            continue
        edges.append(
            f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" '
            f'stroke="rgba(11,13,16,0.18)" stroke-width="1"/>'
        )
    circles = []
    for n in nodes:
        p = pos.get(n["id"])
        if not p:
            continue
        color = colors[int(n.get("community") or 0) % len(colors)]
        circles.append(
            f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="3.2" fill="{color}" '
            f'stroke="rgba(11,13,16,0.35)" stroke-width="0.8"/>'
        )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
        f'<rect width="100%" height="100%" fill="#f3f4f6"/>{"".join(edges)}{"".join(circles)}</svg>'
    )
    return svg.encode("utf-8")


def ensure_repo(owner: str, repo: str) -> Path:
    dest = SEED_DIR / owner / repo
    if (dest / ".git").exists():
        print(f"reusing clone {dest}", flush=True)
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.rmtree(dest)
    run(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--single-branch",
            f"https://github.com/{owner}/{repo}.git",
            str(dest),
        ],
        timeout=600,
    )
    return dest


def build_and_upload(owner: str, repo: str, label: str) -> None:
    dest = ensure_repo(owner, repo)
    run([GRAPHIFY, "extract", str(dest), "--force", "--code-only"], cwd=dest, timeout=3600)
    try:
        run([GRAPHIFY, "cluster-only", str(dest), "--no-label"], cwd=dest, timeout=600)
    except subprocess.CalledProcessError as e:
        print(f"cluster skipped: {e}", flush=True)

    out = dest / "graphify-out"
    graph_file = out / "graph.json"
    if not graph_file.exists():
        # some versions write under haywire-out / graphifyy-out
        for alt in (dest / "haywire-out" / "graph.json", dest / "graphifyy-out" / "graph.json"):
            if alt.exists():
                graph_file = alt
                out = alt.parent
                break
    if not graph_file.exists():
        raise FileNotFoundError(f"no graph.json under {dest}")

    graph = json.loads(graph_file.read_text(encoding="utf-8"))
    report_path = out / "GRAPH_REPORT.md"
    report = report_path.read_text(encoding="utf-8", errors="replace") if report_path.exists() else None
    summary = summarize(graph, report)
    commit = None
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=str(dest), text=True
        ).strip()
    except Exception:
        pass

    result = {
        "owner": owner,
        "repo": repo,
        "cached": False,
        "graph": graph,
        "summary": summary,
        "report": report,
        "meta": {
            "owner": owner,
            "repo": repo,
            "code_only": True,
            "commit": commit,
            "seeded_locally": True,
        },
    }

    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        graph_path = tdp / "analyze.json"
        graph_path.write_text(json.dumps(result), encoding="utf-8")
        thumb_path = tdp / "thumb.svg"
        thumb_path.write_bytes(svg_thumbnail(graph))
        report_storage = None
        if report:
            report_path_tmp = tdp / "report.md"
            report_path_tmp.write_text(report, encoding="utf-8")
            report_storage = upload_blob(report_path_tmp, "text/markdown;charset=utf-8")

        graph_storage = upload_blob(graph_path, "application/json")
        thumb_storage = upload_blob(thumb_path, "image/svg+xml")

        args = {
            "owner": owner,
            "repo": repo,
            "label": label,
            "nodeCount": summary["node_count"],
            "edgeCount": summary["edge_count"],
            "communityCount": summary["community_count"],
            "graphStorageId": graph_storage,
            "thumbnailStorageId": thumb_storage,
        }
        if report_storage:
            args["reportStorageId"] = report_storage

        try:
            print(convex_run("examples:seedFinalize", args), flush=True)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"seedFinalize failed: {e}") from e

    print(
        f"OK {owner}/{repo} nodes={summary['node_count']} edges={summary['edge_count']}",
        flush=True,
    )
    # free disk for next repo
    try:
        shutil.rmtree(dest)
    except Exception:
        pass


def main() -> None:
    catalog = [
        ("openclaw", "openclaw", "OpenClaw"),
        ("mermaid-js", "mermaid", "Mermaid"),
        ("langchain-ai", "langchain", "LangChain"),
    ]
    if len(sys.argv) >= 3:
        owner, repo = sys.argv[1], sys.argv[2]
        label = sys.argv[3] if len(sys.argv) > 3 else repo
        catalog = [(owner, repo, label)]
    for owner, repo, label in catalog:
        print(f"\n======== {owner}/{repo} ========", flush=True)
        build_and_upload(owner, repo, label)


if __name__ == "__main__":
    main()
