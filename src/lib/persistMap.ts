import { dataUrlToBlob } from "@/lib/graphThumbnail";
import { renderMapThumbnail } from "@/lib/mapThumbnail";
import type { SystemMapSpec } from "@/lib/systemMap";

type UploadFn = () => Promise<string>;

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

/** Render the isometric city and upload it; returns a Convex storage id. */
export async function uploadMapThumbnail(
  spec: SystemMapSpec,
  generateUploadUrl: UploadFn,
): Promise<string | undefined> {
  const thumb = renderMapThumbnail(spec);
  if (!thumb) return undefined;
  return await uploadBlob(generateUploadUrl, dataUrlToBlob(thumb));
}
