"use client";
import { AlertTriangle, ArrowRight, Info, LoaderCircle } from "lucide-react";
import { useEffect, useId, useState, type ComponentType, type ReactNode } from "react";
import type { DatasetLayer } from "@/lib/types";
import type { Source } from "@/lib/store";

export function Panel({ title, right, children, className = "", tour }: { title: string; right?: ReactNode; children: ReactNode; className?: string; tour?: string }) {
  return <section className={`panel ${className}`} data-tour={tour}><header><h3>{title}</h3>{right}</header><div className="body">{children}</div></section>;
}
export function Stat({ label, value, detail, tone }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "ok" | "bad" | "warn" }) {
  return <div className={`stat ${tone ?? ""}`}><span className="l">{label}</span><span className="v">{value}</span>{detail && <span className="d">{detail}</span>}</div>;
}
export function Badge({ children, tone, title }: { children: ReactNode; tone?: "ok" | "bad" | "warn" | "info"; title?: string }) { return <span className={`badge ${tone ?? ""}`} title={title}>{children}</span>; }
export function ClassBadge({ c, title }: { c: DatasetLayer["class"]; title?: string }) { return <span className={`badge cls cls-${c}`} title={title ?? CLASS_TITLE[c]}>{c}</span>; }
export const CLASS_TITLE: Record<string, string> = { A: "Direct observation / gridded instrument product", B: "Derived calculation", C: "Model assumption", D: "Simulation output", E: "Missing data" };
/** Where a result came from: the live API or the precomputed demo snapshot (never mixed silently). */
export function SourceBadge({ source }: { source?: Source }) {
  if (!source) return null;
  return source === "snapshot"
    ? <Badge tone="warn" title="Precomputed for the Jezero demo route while the API is unreachable. Not a live calculation.">Snapshot · demo data</Badge>
    : <Badge tone="info" title="Computed now by the RedReturn API for the current inputs.">Live calculation</Badge>;
}
export function Notice({ children, tone, icon = true }: { children: ReactNode; tone?: "bad" | "info"; icon?: boolean }) {
  return <div className={`notice ${tone ?? ""}`} role={tone === "bad" ? "alert" : "note"}>{icon && (tone === "info" ? <Info size={15} aria-hidden /> : <AlertTriangle size={15} aria-hidden />)}<div>{children}</div></div>;
}
export function Loading({ label }: { label: string }) { return <div className="empty" role="status"><LoaderCircle className="spin" size={18} aria-hidden /><span>{label}</span></div>; }
export function Empty({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children && <span className="small">{children}</span>}{actions && <div className="row" style={{ justifyContent: "center" }}>{actions}</div>}</div>;
}
export function ErrorState({ message, retry, retryLabel = "Retry", children }: { message: string; retry?: () => void; retryLabel?: string; children?: ReactNode }) {
  return <div className="empty" role="alert"><b style={{ color: "var(--bad)" }}>{message}</b>{children && <span className="small" style={{ maxWidth: "62ch" }}>{children}</span>}{retry && <button className="btn sm" onClick={retry}>{retryLabel}</button>}</div>;
}
/** Suggested next screen, so each page ends with a clear continuation of the mission flow. */
export function NextStep({ label, detail, onClick }: { label: string; detail: string; onClick: () => void }) {
  return <div className="nextstep"><span className="small muted">{detail}</span><button className="btn sm" onClick={onClick}>{label}<ArrowRight size={13} aria-hidden /></button></div>;
}

/**
 * Numeric input that keeps the text the user is typing (e.g. "-", "4.", "") and only commits valid in-range numbers.
 * Out-of-range drafts are flagged instead of being silently clamped mid-typing; leaving the field restores the committed value.
 */
export function NumField({ label, value, onChange, min, max, step = 1, unit, hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; hint?: string }) {
  const [draft, setDraft] = useState(Number.isFinite(value) ? String(value) : "");
  const [focused, setFocused] = useState(false);
  const id = useId();
  useEffect(() => { if (!focused) setDraft(Number.isFinite(value) ? String(value) : ""); }, [value, focused]);
  const v = draft.trim() === "" ? NaN : Number(draft);
  const invalid = !Number.isFinite(v) || (min !== undefined && v < min) || (max !== undefined && v > max);
  const range = min !== undefined && max !== undefined ? `${min} to ${max}` : min !== undefined ? `≥ ${min}` : max !== undefined ? `≤ ${max}` : "a number";
  return <label className="field"><span>{label}{unit ? ` (${unit})` : ""}</span>
    <input type="number" inputMode="decimal" value={draft} min={min} max={max} step={step} aria-invalid={focused && invalid ? true : undefined} aria-describedby={focused && invalid ? `${id}-err` : hint ? `${id}-hint` : undefined}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setDraft(Number.isFinite(value) ? String(value) : ""); }}
      onChange={e => { const t = e.target.value; setDraft(t); const n = t.trim() === "" ? NaN : Number(t); if (Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onChange(n); }} />
    {focused && invalid ? <small id={`${id}-err`} className="field-err">Enter {range}.</small> : hint && <small id={`${id}-hint`}>{hint}</small>}</label>;
}
export function Range({ label, value, onChange, min, max, step = 1, unit = "" }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string }) {
  return <label className="range"><span>{label}<b>{value}{unit}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} aria-valuetext={`${value}${unit}`} /></label>;
}
export function PageHead({ icon: Icon, title, children, right }: { icon?: ComponentType<{ size?: number }>; title: string; children?: ReactNode; right?: ReactNode }) {
  return <div className="pagehead"><div className="ph-main">{Icon && <span className="ph-ico" aria-hidden><Icon size={18} /></span>}<div><h1>{title}</h1>{children && <p>{children}</p>}</div></div>{right && <div className="ph-right">{right}</div>}</div>;
}
