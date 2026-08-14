#!/usr/bin/env python3
"""Download full example graphs from Convex and attach ~3.5k-node display subsets."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAX_NODES = 3500
MAX_EDGES = 8000


def convex_run(fn: str, args: dict | None = None) -> str:
    cmd = ["npx", "convex", "run", "--prod", fn]
    if args is not None:
        cmd.append(json.dumps(args))
    return subprocess.check_output(cmd, cwd=str(ROOT), text=True).strip()


def upload(path: Path, content_type: str) -> str:
    url = convex_run("examples:generateUploadUrl").strip().strip('"')
    print(f"  upload {path.name} ({path.stat().st_size:,} bytes)", flush=True)
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
    if "storageId" not in data:
        raise RuntimeError(res[:500])
    return data["storageId"]


def build_subset(payload: dict) -> dict:
    # AnalyzeResult has summary + graph.nodes; raw graphify JSON also has a
    # metadata key named "graph" (dict without nodes) — don't confuse them.
    nested = payload.get("graph")
    if (
        isinstance(nested, dict)
        and isinstance(nested.get("nodes"), list)
        and "summary" in payload
    ):
        owner = payload.get("owner", "")
        repo = payload.get("repo", "")
        report = payload.get("report")
        summary = payload.get("summary") or {}
        meta = payload.get("meta") or {}
        graph = nested
    else:
        owner = payload.get("owner", "")
        repo = payload.get("repo", "")
        report = None
        summary = {}
        meta = {}
        graph = payload

    nodes = graph.get("nodes") or []
    links = graph.get("links") or []
    full_n, full_e = len(nodes), len(links)
    if full_n <= MAX_NODES:
        print(f"  already small ({full_n} nodes) — skip", flush=True)
        return {}

    degree: dict[str, int] = {}
    for e in links:
        degree[e.get("source", "")] = degree.get(e.get("source", ""), 0) + 1
        degree[e.get("target", "")] = degree.get(e.get("target", ""), 0) + 1

    by_c: dict[int, list] = {}
    for n in nodes:
        c = int(n.get("community") or 0)
        by_c.setdefault(c, []).append(n)
    ranked_c = sorted(by_c.items(), key=lambda kv: len(kv[1]), reverse=True)

    selected: set[str] = set()
    hubs = sorted(nodes, key=lambda n: degree.get(n.get("id", ""), 0), reverse=True)[
        : min(400, MAX_NODES)
    ]
    for n in hubs:
        selected.add(n["id"])

    for _, members in ranked_c:
        if len(selected) >= MAX_NODES:
            break
        ranked = sorted(members, key=lambda n: degree.get(n.get("id", ""), 0), reverse=True)
        quota = max(8, (MAX_NODES - len(selected)) // max(1, len(ranked_c)))
        for n in ranked[:quota]:
            if len(selected) >= MAX_NODES:
                break
            selected.add(n["id"])

    for e in links:
        if len(selected) >= MAX_NODES:
            break
        s, t = e.get("source"), e.get("target")
        if s in selected and t not in selected:
            selected.add(t)
        elif t in selected and s not in selected:
            selected.add(s)

    keep_nodes = [n for n in nodes if n.get("id") in selected]
    keep_ids = {n["id"] for n in keep_nodes}
    keep_links = [
        e for e in links if e.get("source") in keep_ids and e.get("target") in keep_ids
    ][:MAX_EDGES]

    return {
        "owner": owner,
        "repo": repo,
        "cached": True,
        "graph": {**{k: v for k, v in graph.items() if k not in ("nodes", "links")}, "nodes": keep_nodes, "links": keep_links},
        "summary": {
            "node_count": len(keep_nodes),
            "edge_count": len(keep_links),
            "community_count": len({n.get("community", 0) for n in keep_nodes}),
            "confidence": (summary.get("confidence") if isinstance(summary, dict) else None) or {},
            "god_nodes": (summary.get("god_nodes") if isinstance(summary, dict) else None) or [],
        },
        "report": report,
        "meta": {
            **(meta if isinstance(meta, dict) else {}),
            "display_subset": True,
            "full_node_count": full_n,
            "full_edge_count": full_e,
        },
    }


def process(owner: str, repo: str) -> None:
    print(f"\n======== {owner}/{repo} ========", flush=True)
    info = json.loads(convex_run("examples:getByRepo", {"owner": owner, "repo": repo}))
    if not info or not info.get("graphUrl"):
        print("  missing full graph", flush=True)
        return
    if info.get("hasDisplaySubset") or info.get("displayGraphUrl"):
        print("  display subset already attached — rebuilding", flush=True)

    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        raw_path = tdp / "full.json"
        print(f"  downloading {info['graphUrl'][:60]}…", flush=True)
        subprocess.check_call(
            ["curl", "-sS", "-L", "-o", str(raw_path), info["graphUrl"]],
        )
        print(f"  downloaded {raw_path.stat().st_size:,} bytes", flush=True)
        payload = json.loads(raw_path.read_text(encoding="utf-8"))
        subset = build_subset(payload)
        if not subset:
            return
        # drop report from display blob to keep it small
        subset["report"] = None
        out = tdp / "display.json"
        out.write_text(json.dumps(subset), encoding="utf-8")
        print(
            f"  subset {subset['summary']['node_count']} nodes / "
            f"{subset['summary']['edge_count']} edges "
            f"({out.stat().st_size:,} bytes)",
            flush=True,
        )
        storage_id = upload(out, "application/json")
        print(
            convex_run(
                "examples:attachDisplaySubset",
                {
                    "owner": owner,
                    "repo": repo,
                    "displayGraphStorageId": storage_id,
                },
            ),
            flush=True,
        )
        print("  OK", flush=True)


def main() -> None:
    targets = [
        ("openclaw", "openclaw"),
        ("langchain-ai", "langchain"),
        ("agent0ai", "agent-zero"),
        ("mermaid-js", "mermaid"),
    ]
    if len(sys.argv) >= 3:
        targets = [(sys.argv[1], sys.argv[2])]
    for owner, repo in targets:
        process(owner, repo)


if __name__ == "__main__":
    main()
