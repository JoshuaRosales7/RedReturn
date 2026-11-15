"use client";
import { Activity, BookOpen, Bot, Check, CircleHelp, Compass, FileText, Globe2, LayoutDashboard, Mountain, RefreshCw, Route, ShieldAlert, Siren } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useMissionStore, type Tab } from "@/lib/store";
import { ErrorBoundary } from "./ErrorBoundary";
import { Tutorial, tourSeen } from "./Tutorial";
import { Glossary } from "./Glossary";
import { FLOW } from "./MissionFlow";
import { STRATEGY_LABEL } from "@/lib/format";
import { OverviewTab } from "./tabs/OverviewTab";
import { ExplorerTab } from "./tabs/ExplorerTab";
import { TerrainTab } from "./tabs/TerrainTab";
import { PlannerTab } from "./tabs/PlannerTab";
import { RiskTab } from "./tabs/RiskTab";
import { EmergencyTab } from "./tabs/EmergencyTab";
import { AresTab } from "./tabs/AresTab";
import { ReportsTab } from "./tabs/ReportsTab";
import { FieldTab } from "./tabs/FieldTab";

const TABS: { id: Tab; label: string; group: string; icon: ComponentType<{ size?: number }>; view: ComponentType }[] = [
  { id: "overview", label: "Overview", group: "Mission", icon: LayoutDashboard, view: OverviewTab },
  { id: "explorer", label: "Mars Explorer", group: "Mission", icon: Globe2, view: ExplorerTab },
  { id: "terrain", label: "Terrain", group: "Mission", icon: Mountain, view: TerrainTab },
  { id: "planner", label: "Planner", group: "Mission", icon: Route, view: PlannerTab },
  { id: "risk", label: "Risk Lab", group: "Analysis", icon: Activity, view: RiskTab },
  { id: "emergency", label: "Emergency", group: "Analysis", icon: Siren, view: EmergencyTab },
  { id: "ares", label: "ARES", group: "Analysis", icon: Bot, view: AresTab },
  { id: "reports", label: "Reports", group: "Output", icon: FileText, view: ReportsTab },
  { id: "field", label: "Field card", group: "Output", icon: Compass, view: FieldTab },
];
const GROUPS = ["Mission", "Analysis", "Output"];

export default function AppShell() {
  const store = useMissionStore();
  const { tab, setTab, init, apiState, sources, snapshot, alternatives, risk, scenario, retryConnection } = store;
  const [glossary, setGlossary] = useState(false);
  const doneTabs = new Set(FLOW.filter(f => f.done(store)).map(f => f.tab));
  useEffect(() => { void init(); }, [init]);           // init also plans the demo route; later input changes re-plan from the store
  const [tour, setTour] = useState(false); const [tourTab, setTourTab] = useState<Tab | null>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (tour || glossary || (e.target as HTMLElement)?.matches("input, textarea, select, [contenteditable]")) return;
      const n = Number(e.key); if (n >= 1 && n <= TABS.length && !e.metaKey && !e.ctrlKey && !e.altKey) setTab(TABS[n - 1].id);
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [setTab, tour, glossary]);
  useEffect(() => { if (!tourSeen()) setTour(true); }, []);
  // Announce section changes for screen-reader users (keys 1–9 switch sections without moving focus).
  const [announce, setAnnounce] = useState(""); const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setAnnounce(`${TABS.find(t => t.id === tab)!.label} section`); }, [tab]);
  /** WAI-ARIA tabs: arrow keys / Home / End move between sections. */
  const onTabKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const i = TABS.findIndex(t => t.id === tab); let n = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") n = (i + 1) % TABS.length; else if (e.key === "ArrowUp" || e.key === "ArrowLeft") n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") n = 0; else if (e.key === "End") n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault(); setTab(TABS[n].id);
    requestAnimationFrame(() => (e.currentTarget.querySelector(`[data-tab="${TABS[n].id}"]`) as HTMLElement | null)?.focus());
  };
  const View = TABS.find(t => t.id === tab)!.view;
  const live = apiState === "online";
  // Only results currently on screen count: a discarded snapshot result must not keep the label alive.
  const usingSnapshot = (!!alternatives && sources.alternatives === "snapshot") || (!!risk && sources.risk === "snapshot") || (!!scenario && sources.scenario === "snapshot");
  const rec = alternatives?.recommended;
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <div className="sr" aria-live="polite" role="status">{announce}</div>
      <header className="topbar">
        <div className="brand"><b>RED<i>RETURN</i></b><span>Mars mission decision intelligence</span></div>
        <div className="ctx" aria-label="Current mission">{rec ? <><span className="chip ok">Plan: {STRATEGY_LABEL[rec]}</span></> : alternatives ? <span className="chip bad">No route meets all constraints</span> : store.longRange ? <span className="chip warn">Long-range overview</span> : null}</div>
        <div className="chips" data-tour="status">
          {apiState === "offline"
            ? <button className="chip bad chipbtn" onClick={() => void retryConnection()} title="The RedReturn API is unreachable. Click to try again."><span>API offline</span><RefreshCw size={11} aria-hidden /><span className="sr">— retry connection</span></button>
            : <span role="status" className={`chip ${live ? "ok" : ""}`}>{live ? "API online" : "Connecting…"}</span>}
          {usingSnapshot && <span className="chip warn" title={`${snapshot?.snapshot.note ?? ""} Only the Jezero demo route is available offline.`}>Precomputed snapshot</span>}
          <span className="chip hide-sm">Prototype · not certified</span>
          <button className="iconbtn" aria-label="Glossary" title="Glossary: key terms in plain words" onClick={() => setGlossary(true)}><BookOpen size={16} /></button>
          <button className="iconbtn" aria-label="Show guided tour" title="Guided tour" onClick={() => setTour(true)}><CircleHelp size={17} /></button>
        </div>
      </header>
      <div className="frame">
        <aside className="side">
          <nav role="tablist" aria-label="Sections" aria-orientation="vertical" onKeyDown={onTabKey}>
            {GROUPS.map(g => <div key={g} className="navgroup"><span className="navlabel">{g}</span>
              {TABS.map((t, i) => ({ t, i })).filter(x => x.t.group === g).map(({ t: { id, label, icon: Icon }, i }) => (
                <button key={id} id={`tab-${id}`} data-tab={id} role="tab" aria-controls="main" tabIndex={tab === id ? 0 : -1} className={`tab ${tourTab === id ? "tour-hl" : ""}`} aria-selected={tab === id} onClick={() => setTab(id)} title={`${label} (key ${i + 1})`}><Icon size={16} aria-hidden /><span>{label}</span>{doneTabs.has(id) && <i className="navdone" title="Done for the current mission"><Check size={11} aria-hidden /><span className="sr"> (done)</span></i>}<kbd aria-hidden>{i + 1}</kbd></button>))}
            </div>)}
          </nav>
          <div className="sidefoot tiny dim">Real NASA MOLA terrain · assumptions are labelled · nothing is certified.</div>
        </aside>
        <main className="main" id="main" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}><ErrorBoundary key={tab} label={TABS.find(t => t.id === tab)!.label}><View /></ErrorBoundary></main>
      </div>
      <nav className="bottomnav" role="tablist" aria-label="Sections (mobile)" onKeyDown={onTabKey}>
        {TABS.map(({ id, label, icon: Icon }) => <button key={id} data-tab={id} role="tab" aria-controls="main" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} onClick={() => setTab(id)}><Icon size={18} aria-hidden />{label.replace("Mars ", "")}</button>)}
      </nav>
      <footer className="legal"><ShieldAlert size={13} /><span><b>Research &amp; education prototype.</b> Not operational guidance, not validated or endorsed by NASA. Terrain-evaluated ≠ safe. “Feasible within model” ≠ safe.</span></footer>
      <Tutorial open={tour} onClose={() => setTour(false)} setTab={setTab} onStep={setTourTab} onGlossary={() => setGlossary(true)} />
      <Glossary open={glossary} onClose={() => setGlossary(false)} />
    </div>
  );
}
