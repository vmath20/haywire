export function apiUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_HAYWIRE_API_URL || "").replace(/\/$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  // Same-origin proxy path used in local/dev and Vercel rewrites
  if (!base) return `/api/backend${clean}`;
  return `${base}${clean}`;
}
