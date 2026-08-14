/** Canonical in-app path for a repository graph workspace. */
export function graphPath(owner: string, repo: string): string {
  return `/dashboard/graph/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** Canonical path for a saved query chat thread. */
export function queryChatPath(chatId: string): string {
  return `/dashboard/query/${encodeURIComponent(chatId)}`;
}
