import {
  convexAuthNextjsMiddleware,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { graphPath } from "@/lib/paths";

const RESERVED_FIRST_SEGMENTS = new Set([
  "signin",
  "browse",
  "dashboard",
  "api",
  "_next",
]);

/** Repo graph routes look like /{owner}/{repo} */
function isRepoGraphPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return false;
  return !RESERVED_FIRST_SEGMENTS.has(parts[0].toLowerCase());
}

function safeNextPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.startsWith("/signin")) return null;
  return raw;
}

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const { pathname, searchParams } = request.nextUrl;
  const authenticated = await convexAuth.isAuthenticated();

  if (pathname === "/signin" || pathname.startsWith("/signin/")) {
    if (authenticated) {
      const next = safeNextPath(searchParams.get("next")) ?? "/dashboard";
      return nextjsMiddlewareRedirect(request, next);
    }
    return;
  }

  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    if (!authenticated) {
      const url = request.nextUrl.clone();
      url.pathname = "/signin";
      url.search = "";
      url.searchParams.set("next", pathname);
      return Response.redirect(url);
    }
    return;
  }

  if (pathname === "/browse" || pathname.startsWith("/browse/")) {
    if (!authenticated) {
      const url = request.nextUrl.clone();
      url.pathname = "/signin";
      url.search = "";
      url.searchParams.set("next", "/dashboard/query");
      return Response.redirect(url);
    }
    return nextjsMiddlewareRedirect(request, "/dashboard/query");
  }

  if (isRepoGraphPath(pathname)) {
    const parts = pathname.split("/").filter(Boolean);
    const target = graphPath(parts[0], parts[1]);
    if (!authenticated) {
      const url = request.nextUrl.clone();
      url.pathname = "/signin";
      url.search = "";
      url.searchParams.set("next", target);
      return Response.redirect(url);
    }
    return nextjsMiddlewareRedirect(request, target);
  }
});

export const config = {
  // Node runtime required: Vercel Services do not support Edge middleware.
  runtime: "nodejs",
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
