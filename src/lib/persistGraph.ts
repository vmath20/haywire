import type { AnalyzeResult } from "@/lib/types";
import {
  analyzeResultToBlob,
  dataUrlToBlob,
  renderGraphThumbnail,
} from "@/lib/graphThumbnail";

type UploadFn = () => Promise<string>;
type SaveFn = (args: {
  owner: string;
  repo: string;
  label?: string;
  nodeCount?: number;
  edgeCount?: number;
  communityCount?: number;
  cached?: boolean;
  graphStorageId?: string;
  reportStorageId?: string;
  thumbnailStorageId?: string;
}) => Promise<unknown>;

async function uploadBlob(generateUploadUrl: UploadFn, blob: Blob): Promise<string> {
  const uploadUrl = await generateUploadUrl();
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
  const json = (await res.json()) as { storageId: string };
  return json.storageId;
}

/** Persist full AnalyzeResult + report + thumbnail into Convex file storage. */
export async function persistGraphArtifacts(opts: {
  result: AnalyzeResult;
  generateUploadUrl: UploadFn;
  save: SaveFn;
}): Promise<void> {
  const { result, generateUploadUrl, save } = opts;
  const graphStorageId = await uploadBlob(generateUploadUrl, analyzeResultToBlob(result));

  let reportStorageId: string | undefined;
  if (result.report) {
    reportStorageId = await uploadBlob(
      generateUploadUrl,
      new Blob([result.report], { type: "text/markdown;charset=utf-8" }),
    );
  }

  let thumbnailStorageId: string | undefined;
  const thumb = renderGraphThumbnail(result.graph);
  if (thumb) {
    thumbnailStorageId = await uploadBlob(generateUploadUrl, dataUrlToBlob(thumb));
  }

  await save({
    owner: result.owner,
    repo: result.repo,
    label: result.repo,
    nodeCount: result.summary.node_count,
    edgeCount: result.summary.edge_count,
    communityCount: result.summary.community_count,
    cached: result.cached,
    graphStorageId,
    reportStorageId,
    thumbnailStorageId,
  });
}
