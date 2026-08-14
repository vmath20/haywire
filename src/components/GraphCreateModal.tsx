"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { parseGithubInput } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (owner: string, repo: string) => void;
};

export function GraphCreateModal({ open, onClose, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setValue("");
    setError(null);
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseGithubInput(value);
    if (!parsed) {
      setError("Enter a GitHub URL or owner/repo");
      return;
    }
    setError(null);
    onSubmit(parsed.owner, parsed.repo);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md rounded-2xl border border-black/10 bg-white p-5 shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="font-display text-2xl font-bold tracking-tight text-wire-ink">
              Graph a repository
            </h2>
            <p className="mt-1 text-sm text-wire-mute">
              Paste a public GitHub URL or <span className="font-mono">owner/repo</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-wire-mute transition hover:bg-black/5 hover:text-wire-ink"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <label className="block">
            <span className="sr-only">Repository</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="github.com/owner/repo"
              className="w-full rounded-xl border border-black/10 bg-[#f6f7f8] px-3.5 py-3 text-sm outline-none ring-wire-ink/20 placeholder:text-wire-mute/70 focus:bg-white focus:ring-2"
            />
          </label>
          {error ? <p className="text-sm text-wire-ember">{error}</p> : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-wire-mute transition hover:bg-black/5 hover:text-wire-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-wire-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-wire-ink/90"
            >
              Graph it
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
