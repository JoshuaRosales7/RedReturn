"use client";
import { Check } from "lucide-react";
import { useMissionStore, type Tab } from "@/lib/store";

type S = ReturnType<typeof useMissionStore.getState>;
/** The mission journey, in order. A step is done when its result exists for the current inputs (and, for viewing steps, it was opened). */
export const FLOW: { tab: Tab; label: string; hint: string; done: (s: S) => boolean }[] = [
  { tab: "explorer", label: "Choose points", hint: "Pick a base and a target", done: s => !!s.alternatives || !!s.longRange },
  { tab: "terrain", label: "Check terrain", hint: "See the real ground", done: s => (!!s.alternatives || !!s.longRange) && s.visited.includes("terrain") },
  { tab: "planner", label: "Compare routes", hint: "Four strategies side by side", done: s => (!!s.alternatives || !!s.longRange) && s.visited.includes("planner") },
  { tab: "risk", label: "Test uncertainty", hint: "Thousands of what-ifs", done: s => !!s.risk },
  { tab: "emergency", label: "Break the plan", hint: "Simulate a failure", done: s => !!s.scenario },
  { tab: "reports", label: "Export", hint: "PDF, JSON, GeoJSON", done: s => !!s.alternatives && s.visited.includes("reports") },
];

export function MissionFlow() {
  const s = useMissionStore();
  const next = FLOW.findIndex(f => !f.done(s));
  return (
    <nav className="flow" aria-label="Mission steps" data-tour="flow">
      <ol>
        {FLOW.map((f, i) => { const done = f.done(s), current = i === next; return (
          <li key={f.tab} className={done ? "done" : current ? "current" : ""}>
            <button onClick={() => s.setTab(f.tab)} aria-current={current ? "step" : undefined}>
              <span className="flow-n" aria-hidden>{done ? <Check size={13} /> : i + 1}</span>
              <span className="flow-t"><b>{f.label}</b><span>{done ? "Done" : current ? `Next · ${f.hint}` : f.hint}</span></span>
              <span className="sr">{done ? " (done)" : current ? " (next step)" : ""}</span>
            </button>
          </li>); })}
      </ol>
    </nav>
  );
}
