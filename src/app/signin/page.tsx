"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export default function SignInPage() {
  return (
    <Suspense fallback={<SignInShell pending={false} error={null} onGoogle={() => undefined} />}>
      <SignInContent />
    </Suspense>
  );
}

function SignInContent() {
  const { signIn } = useAuthActions();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = safeNext(searchParams.get("next"));

  async function handleGoogle() {
    setPending(true);
    setError(null);
    try {
      await signIn("google", { redirectTo: next ?? "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setPending(false);
    }
  }

  return (
    <SignInShell
      pending={pending}
      error={error}
      onGoogle={handleGoogle}
      next={next}
    />
  );
}

function SignInShell({
  pending,
  error,
  onGoogle,
  next,
}: {
  pending: boolean;
  error: string | null;
  onGoogle: () => void;
  next?: string | null;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-wire-mute">Account</p>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-wire-ink">
        Sign in to continue
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-wire-mute">
        {next
          ? "Sign in with Google to open that repository graph."
          : "Sign in with Google to graph a GitHub repository."}
      </p>

      <button
        type="button"
        onClick={onGoogle}
        disabled={pending}
        className="mt-8 inline-flex items-center justify-center gap-3 rounded-md bg-wire-ink px-4 py-3 text-sm font-semibold text-wire-paper transition hover:bg-wire-ink/90 disabled:opacity-60"
      >
        <GoogleMark />
        {pending ? "Redirecting…" : "Continue with Google"}
      </button>

      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <p className="mt-6 text-center text-sm text-wire-mute">
        <Link href="/" className="underline decoration-wire-line underline-offset-4 hover:text-wire-ink">
          Back to home
        </Link>
      </p>
    </div>
  );
}

function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.startsWith("/signin")) return null;
  return raw;
}

function GoogleMark() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        opacity=".9"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        opacity=".75"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        opacity=".85"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        opacity=".7"
      />
    </svg>
  );
}
