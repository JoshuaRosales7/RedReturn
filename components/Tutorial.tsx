"use client";
import { Activity, ArrowLeft, ArrowRight, BookOpen, Bot, CheckCircle2, FileText, Globe2, LayoutDashboard, Mountain, Route, ShieldAlert, Siren, Signal, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Tab } from "@/lib/store";
import { term } from "@/lib/glossary";

export const TOUR_KEY = "redreturn.tour.v1";
export const tourSeen = () => { try { return localStorage.getItem(TOUR_KEY) === "done"; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(TOUR_KEY, "done"); } catch { /* private mode: tour may show again, harmless */ } };

type Step = { tab: Tab | null; icon: LucideIcon; title: string; body: string; actions?: string[]; termId?: string; target?: string };

/** Plain-language tour: each step opens a section, highlights the part it talks about and explains one key idea. */
const STEPS: Step[] = [
  { tab: null, icon: LayoutDashboard, title: "Welcome to RedReturn", body: "" },
  { tab: "overview", icon: LayoutDashboard, title: "1 · Overview", target: "flow",
    body: "Your mission on one screen: the recommended route, how much margin the crew has to get back, and which checks are still pending.",
    actions: ["Follow the mission steps from left to right.", "“Reload Jezero demo” brings back the example mission at any time."], termId: "margin" },
  { tab: "explorer", icon: Globe2, title: "2 · Mars Explorer", target: "points",
    body: "Choose where the crew starts (the base) and where it goes (the target). Click the close-up or world map, type coordinates, or pick a named place.",
    actions: ["Use the Base / Target switch to decide what a click moves; zoom the close-up map to place points precisely.", "Up to ~150 km apart you get the full analysis; farther apart, a long-range overview route."], termId: "mola" },
  { tab: "terrain", icon: Mountain, title: "3 · Terrain", target: "terrain",
    body: "The real ground between your two points: a shaded relief map and a 3D model built from NASA measurements, with the candidate routes drawn on top.",
    actions: ["Red areas are steeper than your slope limit.", "Drag the 3D view to rotate it; the height stretch only changes the picture."], termId: "slope" },
  { tab: "planner", icon: Route, title: "4 · Planner", target: "routes",
    body: "Set the crew, rover and supplies. RedReturn plans four different routes and explains why they differ in time, energy and steepness.",
    actions: ["Change any value on the left — routes update automatically.", "Pick a row to make it the route analysed in the next steps."], termId: "feasible" },
  { tab: "risk", icon: Activity, title: "5 · Risk Lab", target: "risk",
    body: "Real missions are uncertain. Risk Lab replays the plan thousands of times with slightly different assumptions and shows which ones matter most.",
    actions: ["Look at “Sensitivity” to see the assumption to check first."], termId: "montecarlo" },
  { tab: "emergency", icon: Siren, title: "6 · Emergency", target: "incident",
    body: "Break the plan on purpose — a battery loss, a slower rover, a blocked path — and compare continuing, rerouting or turning back.",
    actions: ["Choose an incident, then press “Simulate failure & replan”."], termId: "strategy" },
  { tab: "ares", icon: Bot, title: "7 · ARES assistant", target: "ares",
    body: "Ask questions in plain words, like “why is this route better?”. Every answer is built from the calculations and lists its evidence.",
    actions: ["Start with one of the suggested questions."] },
  { tab: "reports", icon: FileText, title: "8 · Reports", target: "export",
    body: "Download the analysis as PDF, as JSON with everything needed to reproduce it, or as GeoJSON routes for map software. You can also see every data source.",
    termId: "classes" },
  { tab: null, icon: Signal, title: "Status at the top", target: "status",
    body: "The top bar tells you if live calculations are available. “API offline” means only the saved demo can be shown — click it to reconnect.",
    termId: "snapshot" },
  { tab: "overview", icon: ShieldAlert, title: "You're ready", body: "" },
];

const QUICKSTART = ["Pick a base and a target in Mars Explorer", "Look at the ground in Terrain", "Compare the routes in Planner", "Test uncertainty in Risk Lab", "Break the plan in Emergency"];

export function Tutorial({ open, onClose, setTab, onStep, onGlossary }: { open: boolean; onClose: () => void; setTab: (t: Tab) => void; onStep: (t: Tab | null) => void; onGlossary?: () => void }) {
  const [i, setI] = useState(0); const card = useRef<HTMLDivElement>(null);
  const step = STEPS[i], last = i === STEPS.length - 1, first = i === 0;
  const close = () => { markSeen(); onStep(null); onClose(); };
  useEffect(() => { if (open) setI(0); }, [open]);
  useEffect(() => { if (!open) return; if (step.tab) setTab(step.tab); onStep(step.tab); card.current?.focus(); }, [open, i]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spotlight the part of the page the step talks about (after the section has rendered).
  useEffect(() => {
    if (!open || !step.target) return;
    let el: Element | null = null;
    const t = setTimeout(() => {
      el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) return;
      el.classList.add("tour-target");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: window.innerWidth <= 1100 ? "start" : "center", behavior: reduce ? "auto" : "smooth" });   // on phones the card is a bottom sheet: keep the target above it
    }, 250);
    return () => { clearTimeout(t); el?.classList.remove("tour-target"); };
  }, [open, i, step.target]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(); else if (e.key === "ArrowRight" && !last) setI(v => v + 1); else if (e.key === "ArrowLeft" && !first) setI(v => v - 1);
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const Icon = step.icon; const t = step.termId ? term(step.termId) : null;
  const pct = Math.round((i / (STEPS.length - 1)) * 100);
  return (
    <>
      {(first || last) && <div className="tour-backdrop" aria-hidden onClick={close} />}
      <div ref={card} tabIndex={-1} role="dialog" aria-modal={first || last} aria-label={`Guided tour, step ${i + 1} of ${STEPS.length}`} aria-describedby="tour-body" className={`tour ${first ? "welcome" : last ? "welcome final" : ""}`}>
        <button className="tour-x" aria-label="Skip tour" onClick={close}><X size={15} /></button>
        {first ? <>
          <div className="tour-hero" aria-hidden><span className="tour-planet" /><b>RED<i>RETURN</i></b></div>
          <h2>Welcome to RedReturn</h2>
          <p id="tour-body" className="lead">Plan a crew trip across the surface of Mars and find out whether, according to the model, the crew can reach a target, do its science and come back — and why.</p>
          <ul className="pillars">
            <li><Mountain size={18} aria-hidden /><div><b>Real Mars terrain</b><span>Heights measured by NASA&apos;s MOLA laser, not artwork.</span></div></li>
            <li><BookOpen size={18} aria-hidden /><div><b>Every number explained</b><span>You can see where each result comes from and what is assumed.</span></div></li>
            <li><ShieldAlert size={18} aria-hidden /><div><b>A learning tool</b><span>For education and research. It does not certify real missions.</span></div></li>
          </ul>
          <p className="tip">The tour takes about 2 minutes and never changes your inputs. Use ← → to move, Esc to leave.</p>
        </> : last ? <>
          <div className="tour-head"><span className="tour-ico ok" aria-hidden><CheckCircle2 size={18} /></span><div><div className="tour-step tiny">Step {i + 1} of {STEPS.length}</div><h2>{step.title}</h2></div></div>
          <p id="tour-body">A good first mission, in five steps:</p>
          <ol className="quick">{QUICKSTART.map(q => <li key={q}>{q}</li>)}</ol>
          <div className="tour-limits"><ShieldAlert size={15} aria-hidden /><p>Remember the limits: terrain is a 463 m grid, so boulders and small craters are invisible; supplies use editable assumptions; “feasible in model” never means safe.</p></div>
          <p className="tip">Replay this tour with the <b>?</b> button, and look up any word in the <b>Glossary</b>.</p>
        </> : <>
          <div className="tour-head"><span className="tour-ico" aria-hidden><Icon size={18} /></span><div><div className="tour-step tiny">Step {i + 1} of {STEPS.length}</div><h2>{step.title}</h2></div></div>
          <p id="tour-body">{step.body}</p>
          {step.actions && <ul className="tour-actions">{step.actions.map(a => <li key={a}>{a}</li>)}</ul>}
          {t && <div className="tour-term"><span className="tiny">Key idea</span><b>{t.term}</b><p>{t.short} {t.detail}</p></div>}
        </>}
        <div className="tour-progress" aria-hidden><i style={{ width: `${pct}%` }} /></div>
        <div className="row between">
          {last ? (onGlossary ? <button className="btn sm" onClick={() => { close(); onGlossary(); }}><BookOpen size={13} aria-hidden />Open glossary</button> : <span />) : <button className="btn sm" onClick={close}>Skip tour</button>}
          <div className="row" style={{ flexWrap: "nowrap" }}>
            {!first && <button className="btn sm" onClick={() => setI(v => v - 1)}><ArrowLeft size={13} />Back</button>}
            <button className="btn sm primary" onClick={() => (last ? close() : setI(v => v + 1))}>{last ? "Start exploring" : first ? "Take the tour" : "Next"}{!last && <ArrowRight size={13} />}</button>
          </div>
        </div>
      </div>
    </>
  );
}
