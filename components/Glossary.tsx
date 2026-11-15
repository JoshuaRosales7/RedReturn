"use client";
import { BookOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GLOSSARY } from "@/lib/glossary";

/** Plain-language definitions of the terms used across RedReturn. */
export function Glossary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null); const [q, setQ] = useState("");
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", h);
    return () => { window.removeEventListener("keydown", h); prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  const items = GLOSSARY.filter(t => (t.term + t.short + t.detail).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="tour-backdrop" aria-hidden onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="glossary-title" className="glossary">
        <div className="row between" style={{ flexWrap: "nowrap" }}>
          <h2 id="glossary-title" className="row" style={{ gap: 8 }}><BookOpen size={18} aria-hidden />Glossary</h2>
          <button className="tour-x" style={{ position: "static" }} aria-label="Close glossary" onClick={onClose}><X size={15} /></button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>The ideas you meet in RedReturn, in plain words.</p>
        <input className="input" type="search" placeholder="Search a term…" aria-label="Search the glossary" value={q} onChange={e => setQ(e.target.value)} />
        <dl className="gloss-list">
          {items.map(t => <div key={t.id}><dt>{t.term}</dt><dd><b>{t.short}</b> {t.detail}</dd></div>)}
          {items.length === 0 && <p className="small muted">No term matches “{q}”.</p>}
        </dl>
      </div>
    </>
  );
}
