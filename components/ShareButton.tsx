"use client";
import { Check, Link2 } from "lucide-react";
import { useState } from "react";

/** Copies the current mission link (the URL already carries base, target, stops and changed settings). */
export function ShareButton() {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const copy = async () => {
    try { await navigator.clipboard.writeText(location.href); setState("copied"); setTimeout(() => setState("idle"), 2500); }
    catch { setState("manual"); }                                   // clipboard blocked (e.g. plain http): show the link to copy by hand
  };
  return (
    <span className="share">
      <button className="btn sm" onClick={() => void copy()} title="Copy a link that reopens this mission (base, target, stops and settings)">
        {state === "copied" ? <Check size={13} aria-hidden /> : <Link2 size={13} aria-hidden />}{state === "copied" ? "Link copied" : "Copy mission link"}
      </button>
      <span className="sr" role="status">{state === "copied" ? "Mission link copied to the clipboard" : ""}</span>
      {state === "manual" && <input className="input share-url" readOnly value={location.href} aria-label="Mission link — copy it manually" onFocus={e => e.currentTarget.select()} autoFocus />}
    </span>
  );
}
