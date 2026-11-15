"use client";
import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { useMissionStore, workingStrategy } from "@/lib/store";
import { coord } from "@/lib/format";
import { ApiFailure } from "@/lib/api";
import { buildPdf, download, fetchGeoJson, fetchReportJson, geoJsonFrom } from "@/lib/report";
import { Badge, ClassBadge, Notice, PageHead, Panel, SourceBadge } from "../ui";
import { PlanStatus } from "../PlanStatus";
import { ShareButton } from "../ShareButton";

const ALIGN: [string, string][] = [
  ["Layered, integrated view from multiple NASA missions (≥3 data kinds)", "Topographic: MOLA numeric DEM (analysis) + MOLA colour shade · Optical: Viking MDIM 2.1 · Thermal: THEMIS day/night IR, TES thermal inertia · Radiation: published MSL RAD rate as model parameter. Tiles are display layers; only MOLA elevation enters calculations."],
  ["Route a crew could plan, avoiding significant obstacles", "Four terrain-aware route strategies on a 463 m DEM with slope cap and explicit nodata blocking. Rock/boulder obstacles are NOT modelled (missing data class E)."],
  ["Astronaut safety, radiation, mobility", "Dose and time constraints, reserves, slope-derated speed and climb energy. Safety is never certified; limits are scenario assumptions."],
  ["Hyperlocal area rather than global view", "Local 25 km corridor analysis on cached 463 m windows (Jezero, Gale). Not yet hyperlocal in the HiRISE/CTX sense — documented limitation."],
  ["Interactive tool + scientific objectives", "Science stops with dwell time; emergency replanning; ARES explanations tied to calculations."],
];

export function ReportsTab() {
  const s = useMissionStore(); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const alt = s.alternatives;
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(`${name} exported.`); } catch (e) { setMsg(`${name} export failed: ${e instanceof ApiFailure && e.offline ? "the API is offline" : e instanceof Error ? e.message : "unknown error"}.`); }
    finally { setBusy(false); }
  };
  const live = s.apiState === "online";
  const jsonReport = () => run("JSON", async () => {
    if (live) { try { download("redreturn-report.json", JSON.stringify(await fetchReportJson(s.reportBody()), null, 2), "application/json"); return; } catch (e) { if (!(e instanceof ApiFailure && e.offline)) throw e; } }
    if (!alt) throw new Error("no analysis available");
    download("redreturn-report-offline.json", JSON.stringify({ note: "Offline export of results already in the browser; reproducibility metadata limited. Not certified.", certification: "NOT_CERTIFIABLE", sources: s.sources, snapshot: Object.values(s.sources).includes("snapshot") ? s.snapshot?.snapshot : undefined, request: s.reportBody(), analysed_strategy: workingStrategy(s), alternatives: alt, risk: s.risk, scenario: s.scenario, data_sources: s.datasets }, null, 2), "application/json");
  });
  const geo = () => run("GeoJSON", async () => {
    if (live) { try { download("redreturn-routes.geojson", JSON.stringify(await fetchGeoJson(s.reportBody()), null, 2), "application/geo+json"); return; } catch (e) { if (!(e instanceof ApiFailure && e.offline)) throw e; } }
    if (!alt) throw new Error("no analysis available");
    download("redreturn-routes-offline.geojson", JSON.stringify(geoJsonFrom(alt, s.origin, s.destination), null, 2), "application/geo+json");
  });
  const pdf = () => run("PDF", async () => { if (!alt) throw new Error("no analysis available"); buildPdf({ alt, risk: s.risk, scenario: s.scenario, datasets: s.datasets, snapshot: s.snapshot, origin: coord(s.origin.lat, s.origin.lon), destination: coord(s.destination.lat, s.destination.lon), strategy: workingStrategy(s), sources: { alternatives: s.sources.alternatives, risk: s.risk ? s.sources.risk : undefined, scenario: s.scenario ? s.sources.scenario : undefined } }).save("redreturn-report.pdf"); });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <PageHead icon={FileText} title="Reports" right={<SourceBadge source={s.sources.alternatives} />}>Export the analysis, see where every dataset comes from, and check the challenge requirements against what RedReturn actually does.</PageHead>
      <Panel title="Export mission report" tour="export" right={<Badge tone="warn">not certified</Badge>}>
        <div className="row"><button className="btn primary" onClick={pdf} disabled={!alt || busy}><Download size={14} />PDF report</button><button className="btn" onClick={jsonReport} disabled={!alt || busy}><Download size={14} />JSON + reproducibility</button><button className="btn" onClick={geo} disabled={!alt || busy}><Download size={14} />GeoJSON routes</button><ShareButton /></div>
        {msg && <p className="small" role="status" style={{ marginBottom: 0 }}>{msg}</p>}
        {!alt && <PlanStatus what="analysis to export" feature="Report export" />}
        {alt && <p className="tiny muted" style={{ marginBottom: 0 }}>Includes: routes{s.risk ? ", uncertainty ensemble" : " (run Risk Lab to add the ensemble)"}{s.scenario ? ", emergency scenario" : " (run Emergency to add a scenario)"}. {live ? "JSON and GeoJSON are recomputed by the API." : "API offline: JSON and GeoJSON are exported from the results already shown."}</p>}
        <p className="tiny dim">JSON includes the request, seed, engine versions, DEM file checksums and result hashes so every number can be regenerated. PDF runs entirely in your browser.</p>
      </Panel>
      <Panel title="Data sources and classification">
        <div className="row" style={{ marginBottom: 8 }}>{Object.entries(s.datasets?.classification ?? {}).map(([k, v]) => <span key={k} className="row" style={{ gap: 4 }}><ClassBadge c={k as "A"} /><span className="tiny muted">{v}</span></span>)}</div>
        <div className="tscroll"><table className="t"><thead><tr><th scope="col"><span className="sr">Data class</span></th><th>Dataset</th><th>Source</th><th>Resolution</th><th>Units</th><th>Integration</th><th>Known limitations</th></tr></thead><tbody>
          {(s.datasets?.layers ?? []).map(d => <tr key={d.id}><td><ClassBadge c={d.class} /></td><td>{d.url ? <a href={d.url.replace(/\{.*$/, "")} target="_blank" rel="noreferrer noopener">{d.name}</a> : d.name}<div className="tiny dim">{d.identifier}</div></td><td className="tiny">{d.organization}</td><td className="n">{d.resolution_m ? `${d.resolution_m} m` : "—"}</td><td className="tiny">{d.units ?? "—"}</td><td className="tiny">{d.integration}</td><td className="tiny muted">{d.limitations.join(" ")}</td></tr>)}
        </tbody></table></div>
      </Panel>
      <Panel title="Challenge alignment — Interplanetary Survival Guide: Martian Map" right={<a className="tiny" href="https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/" target="_blank" rel="noreferrer noopener">official page</a>}>
        <div className="tscroll"><table className="t"><thead><tr><th>Requirement</th><th>RedReturn</th></tr></thead><tbody>{ALIGN.map(([a, b]) => <tr key={a}><td style={{ width: "32%" }}>{a}</td><td className="small muted">{b}</td></tr>)}</tbody></table></div>
      </Panel>
      <Notice>RedReturn is an independent educational prototype. It has not been reviewed, validated or endorsed by NASA, USGS or any space agency. See docs/SCIENTIFIC_VALIDATION.md.</Notice>
    </div>
  );
}
