"use client";

import { useState } from "react";

export function CopyButton({
  text,
  fetchText,
  label = "COPY",
  className = "kq-ghost accent mini",
}: {
  text?: string;
  /** Lazily fetch the text to copy (used for large map codes). */
  fetchText?: () => Promise<string>;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");

  async function copy() {
    try {
      const value = fetchText ? await fetchText() : text ?? "";
      await navigator.clipboard.writeText(value);
      setState("ok");
    } catch {
      setState("err");
    }
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button type="button" className={className} onClick={copy}>
      {state === "ok" ? "COPIED ✓" : state === "err" ? "FAILED" : label}
    </button>
  );
}
