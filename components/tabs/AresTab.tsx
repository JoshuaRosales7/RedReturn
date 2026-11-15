"use client";
import { useRef, useState } from "react";
import { Bot, Send } from "lucide-react";
import { currentChatKey, useMissionStore, workingStrategy } from "@/lib/store";
import { STRATEGY_LABEL } from "@/lib/format";
import { Badge, ErrorState, Loading, NextStep, Notice, PageHead, Panel } from "../ui";
import { PlanStatus } from "../PlanStatus";

const SUGGESTED = ["Why is this route preferable?", "What happens if battery capacity drops by 25%?", "How much additional oxygen would the mission require?",
  "Which assumption contributes the most uncertainty?", "What evidence supports this terrain classification?", "Which parts of the route lack adequate scientific data?",
  "What changes improve modeled return margins?", "Why can the system not certify this mission?"];

export function AresTab() {
  const s = useMissionStore(); const [q, setQ] = useState(""); const end = useRef<HTMLDivElement>(null);
  const key = currentChatKey(s);
  const ask = async (text: string) => { if (!text.trim()) return; setQ(""); await s.ask(text.trim()); setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50); };
  const disabled = s.busy.ares || !s.alternatives;
  const err = s.errors.ares;
  return (
    <div className="stack" style={{ gap: 12 }}>
    <PageHead icon={Bot} title="ARES">Ask about the current plan{s.alternatives ? <> (route: <b>{STRATEGY_LABEL[workingStrategy(s)]}</b>)</> : null}. Answers come from the calculation engines, with the evidence and uncertainty shown.</PageHead>
    <div className="dash">
      <div className="col c4 side-sticky">
        <Panel title="Ask ARES" tour="ares"><form className="row" style={{ flexWrap: "nowrap" }} onSubmit={e => { e.preventDefault(); void ask(q); }}>
          <input type="text" className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about the current plan…" aria-label="Question for ARES" maxLength={500} />
          <button className="btn primary" type="submit" disabled={disabled || !q.trim()} aria-label="Send question"><Send size={14} aria-hidden /></button></form>
          <div className="stack" style={{ marginTop: 10 }}>{SUGGESTED.map(x => <button key={x} className="btn sm" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => void ask(x)} disabled={disabled}>{x}</button>)}</div>
          {s.apiState === "offline" && <p className="tiny dim" style={{ marginTop: 8 }}>Offline: only the precomputed answers for the Jezero demo route are available.</p>}
        </Panel>
        <Notice tone="info"><b>How ARES works.</b> It routes your question to the deterministic engines (routes, mission model, Monte Carlo, emergency replanning) and writes the answer from their outputs. Language-model paraphrase is optional, disabled here, and would never supply numbers.</Notice>
      </div>
      <div className="col c8">
        {!s.alternatives && <Panel title="Route plan needed"><PlanStatus what="route plan" feature="ARES" /></Panel>}
        <div className="chat" aria-live="polite" aria-busy={s.busy.ares}>
          {s.chat.length === 0 && s.alternatives && <Panel title="No questions yet"><p className="muted small">Pick a suggested question. Each answer lists the calculations used and its uncertainty.</p></Panel>}
          {s.chat.map((m, i) => { const stale = m.key !== key; return <div key={i} className={`stack ${stale ? "stale" : ""}`}>
            <div className="msg q">{m.q}</div>
            <div className="msg"><div className="row between" style={{ marginBottom: 6 }}><div className="row"><Badge tone="ok">Calculation-based</Badge>{stale && <Badge tone="warn" title="Base, target, configuration or route changed after this answer.">Earlier inputs — ask again</Badge>}</div><span className="tiny dim">{m.source === "snapshot" ? "precomputed snapshot" : "live"} · tools: {m.a.tools_used.join(", ")}</span></div>
              <p style={{ margin: "0 0 8px" }}>{m.a.answer}</p>
              {m.a.evidence.length > 0 && <details><summary className="small muted" style={{ cursor: "pointer" }}>Evidence ({m.a.evidence.length})</summary><ul className="tiny muted">{m.a.evidence.map(e => <li key={e}>{e}</li>)}</ul></details>}
              <div className="tiny dim" style={{ marginTop: 6 }}>Uncertainty: {m.a.uncertainty.join(" ")}</div>
              {!stale && m.a.suggested_experiments.length > 0 && <div className="row" style={{ marginTop: 6 }}><span className="tiny dim">Try next:</span>{m.a.suggested_experiments.map(x => <button key={x} className="btn sm" onClick={() => void ask(x)} disabled={disabled}>{x}</button>)}</div>}
            </div></div>; })}
          {s.busy.ares && <Loading label="Running calculation tools…" />}
          {err && <ErrorState message={err.offline ? "API offline — only precomputed demo answers are available, for the Jezero demo route." : `ARES failed: ${err.message}`} retry={err.offline ? () => void s.retryConnection() : undefined} retryLabel="Retry connection" />}
          <div ref={end} />
        </div>
        {s.chat.length > 0 && <NextStep detail="Done exploring? Export the analysis with its data sources and reproducibility metadata." label="Go to Reports" onClick={() => s.setTab("reports")} />}
      </div>
    </div>
    </div>
  );
}
