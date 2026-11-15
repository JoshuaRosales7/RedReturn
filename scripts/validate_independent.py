"""Independent recomputation of the Jezero demo (second implementation, written separately from api/scientific).

Uses only: rasterio (read GeoTIFF + its affine transform), numpy, the stdlib, and the committed inputs
(api/data/dem/*.tif, api/data/demo_scenario.json, public/data/demo-snapshot.json for the reported numbers).
It does NOT import anything from api/. Same-author second implementation: it catches coding errors and
documentation drift, it is not external validation of the physics.

Usage: .venv/bin/python scripts/validate_independent.py [--md docs/VALIDATION_RESULTS.md]
"""
import heapq, json, math, sys
from pathlib import Path

import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parent.parent
R = 3396190.0
DEG = math.pi / 180
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + " :: " + detail)


# ---------- raster access (own code) ----------------------------------------------------------
ds = rasterio.open(ROOT / "api/data/dem/mola_jezero.tif")
Z = ds.read(1).astype(float)
NODATA = ds.nodata
Z[Z == NODATA] = np.nan
AFF = ds.transform
PX = AFF.a                      # metres per pixel on the projection (463.09)
INV = ~AFF


def rc(lat, lon):               # continuous (row, col) in pixel-edge coordinates, own transform use
    col, row = INV * (R * lon * DEG, R * lat * DEG)
    return row, col


def center_latlon(r, c):
    x, y = AFF * (c + 0.5, r + 0.5)
    return y / R / DEG, x / R / DEG


def nearest(lat, lon):
    r, c = rc(lat, lon)
    return int(math.floor(r)), int(math.floor(c))


def bilinear(lat, lon):
    r, c = rc(lat, lon)
    r -= .5; c -= .5
    r0, c0 = int(math.floor(r)), int(math.floor(c))
    fr, fc = r - r0, c - c0
    q = Z[r0:r0 + 2, c0:c0 + 2]
    if q.shape != (2, 2) or np.isnan(q).any():
        return None
    return q[0, 0] * (1 - fr) * (1 - fc) + q[0, 1] * (1 - fr) * fc + q[1, 0] * fr * (1 - fc) + q[1, 1] * fr * fc


def hav(a, b):
    p1, p2 = a[0] * DEG, b[0] * DEG
    dl = ((b[1] - a[1] + 540) % 360 - 180) * DEG
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def horn(r, c):                 # direct 3x3 formula, plain python
    lat, _ = center_latlon(r, c)
    z = lambda i, j: Z[r + i, c + j]
    nb = [z(i, j) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    if any(math.isnan(v) for v in nb):
        return float("nan")
    dx = PX * math.cos(lat * DEG)
    dzdx = ((z(-1, 1) + 2 * z(0, 1) + z(1, 1)) - (z(-1, -1) + 2 * z(0, -1) + z(1, -1))) / (8 * dx)
    dzdy = ((z(1, -1) + 2 * z(1, 0) + z(1, 1)) - (z(-1, -1) + 2 * z(-1, 0) + z(-1, 1))) / (8 * PX)
    return math.degrees(math.atan(math.hypot(dzdx, dzdy)))


def slerp(a, b, n):
    A = np.array([math.cos(a[0] * DEG) * math.cos(a[1] * DEG), math.cos(a[0] * DEG) * math.sin(a[1] * DEG), math.sin(a[0] * DEG)])
    B = np.array([math.cos(b[0] * DEG) * math.cos(b[1] * DEG), math.cos(b[0] * DEG) * math.sin(b[1] * DEG), math.sin(b[0] * DEG)])
    om = math.acos(max(-1, min(1, A @ B)))
    out = []
    for i in range(n + 1):
        t = i / n
        v = (math.sin((1 - t) * om) * A + math.sin(t * om) * B) / math.sin(om)
        out.append((math.degrees(math.asin(v[2])), math.degrees(math.atan2(v[1], v[0]))))
    return out


# ---------- inputs --------------------------------------------------------------------------
demo = json.loads((ROOT / "api/data/demo_scenario.json").read_text(encoding="utf-8"))
snap = json.loads((ROOT / "public/data/demo-snapshot.json").read_text(encoding="utf-8"))
A = (demo["origin"]["lat"], demo["origin"]["lon"])
B = (demo["destination"]["lat"], demo["destination"]["lon"])
CFG = dict(crew=2, speed=4.5, o2=18.0, o2r=0.084, kwh=45.0, kwhh=1.2, water=12.0, wr=2.5, rad=0.025, radmax=1.0, reserve=.20, hmax=18.0,
           sci=1.5, cont=.15, mass=1500.0, eff=.6, smax=15.0)
assert demo["config"] == {}, "demo uses default config"
sci_total = CFG["sci"] + sum(s["dwell_hours"] for s in demo["science_stops"])

# 1 coordinate transform ---------------------------------------------------------------------
ok = all(abs(center_latlon(*nearest(la, lo))[0] - la) < 0.004 and abs(center_latlon(*nearest(la, lo))[1] - lo) < 0.004 for la, lo in (A, B))
r, c = 500, 500
lat, lon = center_latlon(r, c)
check("DEM coordinate transform round-trip", ok and nearest(lat, lon) == (r, c) and abs(PX - 463.0935415503709) < 1e-9,
      f"cell(500,500) -> ({lat:.5f},{lon:.5f}) -> {nearest(lat, lon)}; pixel {PX:.4f} m; CRS R={R:.0f}")

# 2 source elevations ------------------------------------------------------------------------
zA = bilinear(*A)
api_z = snap["alternatives"]["routes"][0]["coordinates"][0]["elevation_m"]
check("Source elevation at base (independent bilinear)", abs(zA - api_z) < 1e-6, f"{zA:.3f} m vs reported {api_z:.3f} m; nodata cells in window = {int(np.isnan(Z).sum())}")

# 3 horn + max slope on committed routes --------------------------------------------------------
def metrics(pts, interp):
    d = [hav(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    z = [bilinear(*p) if interp else Z[nearest(*p)] for p in pts]
    gain = sum(max(z[i + 1] - z[i], 0) for i in range(len(d)))
    loss = sum(max(z[i] - z[i + 1], 0) for i in range(len(d)))
    al = [math.degrees(math.atan2(abs(z[i + 1] - z[i]), d[i])) for i in range(len(d))]
    loc = [horn(*nearest(*p)) for p in pts]
    return d, z, gain, loss, al, loc


def sf(s):  # slope speed factor
    return min(1.0, max(.25, 1 - s / CFG["smax"]))


def mission(d, z, al, sci, speed=None):
    eff = sum(di / sf(a) for di, a in zip(d, al)) / 1000
    asc_out = sum(max(z[i + 1] - z[i], 0) for i in range(len(d)))
    asc_back = sum(max(z[i] - z[i + 1], 0) for i in range(len(d)))
    return eff, asc_out, asc_back


def full_eval(eff, asc_total, sci, extra=0.0):
    t = 2 * eff / CFG["speed"] + sci + extra
    f = 1 + CFG["cont"]
    climb = CFG["mass"] * 3.71 * asc_total / CFG["eff"] / 3.6e6
    o2 = t * CFG["crew"] * CFG["o2r"] * f
    en = (t * CFG["kwhh"] + climb) * f
    w = t / 24 * CFG["crew"] * CFG["wr"] * f
    dose = t * CFG["rad"]
    rem = (CFG["o2"] - o2, CFG["kwh"] - en, CFG["water"] - w)
    res = (CFG["o2"] * CFG["reserve"], CFG["kwh"] * CFG["reserve"], CFG["water"] * CFG["reserve"])
    m = {"oxygen": (rem[0] - res[0]) / CFG["o2"], "energy": (rem[1] - res[1]) / CFG["kwh"], "water": (rem[2] - res[2]) / CFG["water"],
         "time": (CFG["hmax"] - t) / CFG["hmax"], "radiation": (CFG["radmax"] - dose) / CFG["radmax"]}
    lim = min(m, key=m.get)
    return dict(t=t, o2=o2, en=en, w=w, dose=dose, rem=rem, margins=m, lim=lim, lim_pct=m[lim] * 100, ok=all(v >= 0 for v in m.values()))


by = {r["strategy"]: r for r in snap["alternatives"]["routes"]}
indep = {}
for name, route in by.items():
    pts = [(c["lat"], c["lon"]) for c in route["coordinates"]]
    if name == "shortest":
        n = math.ceil(hav(A, B) / PX)
        pts = slerp(A, B, n)
    d, z, gain, loss, al, loc = metrics(pts, interp=(name == "shortest"))
    eff, ao, ab = mission(d, z, al, sci_total)
    sci = CFG["sci"] + (sum(s["dwell_hours"] for s in (route.get("science_stops_visited") or [])))
    ev = full_eval(eff, ao + ab, sci)
    indep[name] = dict(pts=pts, d=d, z=z, al=al, loc=loc, eff=eff, ao=ao, ab=ab, ev=ev, dist=sum(d) / 1000, gain=gain, loss=loss)
    m = route["metrics"]; q = route["mission"]
    local_valid = [v for v in loc if not math.isnan(v)]
    # the API samples (<=463 m spacing) the shortest line at slightly different points only if n differs; compare tolerant
    tol = 0.05 if name == "shortest" else 1e-6
    good = (abs(sum(d) / 1000 - m["distance_km"]) < max(tol, 1e-6 * m["distance_km"]) and abs(gain - m["elevation_gain_m"]) < max(tol, 1e-6 * gain + tol)
            and abs(max(al) - m["max_slope_deg"]) < max(tol, 1e-6) and abs(ev["lim_pct"] - q["limiting_margin_percent"]) < (0.2 if name == "shortest" else 1e-4)
            and ev["lim"] == q["limiting_factor"])
    check(f"Route '{name}': distance/ascent/max slope/limiting margin", good,
          f"km {sum(d)/1000:.3f} (api {m['distance_km']:.3f}); ascent {gain:.1f} (api {m['elevation_gain_m']:.1f}); max along-track {max(al):.2f}° (api {m['max_slope_deg']:.2f}°); "
          f"max Horn {max(local_valid):.2f}° (api {m['max_local_slope_deg']:.2f}°); margin {ev['lim_pct']:.2f}% on {ev['lim']} (api {q['limiting_margin_percent']:.2f}% on {q['limiting_factor']})")

check("Max-slope detection: shortest exceeds 15°, detours do not",
      max(indep["shortest"]["al"]) > 15 and all(max(indep[k]["al"]) <= 15 and max(v for v in indep[k]["loc"] if not math.isnan(v)) <= 15 for k in ("terrain", "resource", "science")),
      "shortest %.1f° (headline 18.1°); terrain %.1f° (headline 6.9°); resource %.1f°; science %.1f°" % tuple(max(indep[k]["al"]) for k in ("shortest", "terrain", "resource", "science")))
check("Reported headline values reproduce", round(max(indep["shortest"]["al"]), 1) == 18.1 and round(max(indep["terrain"]["al"]), 1) == 6.9, "18.1° and 6.9° from independently sampled data")

# 4 independent Dijkstra: are the committed routes optimal under the documented objectives? -----------------
def grid_cost(obj, path_cells=None):
    nbr = [(i, j) for i in (-1, 0, 1) for j in (-1, 0, 1) if (i, j) != (0, 0)]
    def edge(r, c, rr, cc):
        lat1, _ = center_latlon(r, c)
        dxm = PX * math.cos(lat1 * DEG)
        dxm2 = PX * math.cos(center_latlon(rr, cc)[0] * DEG)
        d = math.hypot((cc - c) * 0.5 * (dxm + dxm2), (rr - r) * PX)
        dz = Z[rr, cc] - Z[r, c]
        s = math.degrees(math.atan2(abs(dz), d))
        L = horn(rr, cc)
        return d, dz, s, L
    return nbr, edge


def unit_cost(obj, d, dz, s, L):
    if obj == "terrain":
        return d * (1 + (max(s, L) / 8.0) ** 2)
    hrs = d / 1000 / (CFG["speed"] * sf(s))
    kwh = hrs * CFG["kwhh"] + CFG["mass"] * 3.71 * abs(dz) / CFG["eff"] / 3.6e6
    return kwh / CFG["kwh"] + hrs * CFG["crew"] * CFG["o2r"] / CFG["o2"] + hrs / 24 * CFG["crew"] * CFG["wr"] / CFG["water"]


def dijkstra(obj, start, goal, margin=60):
    r0, c0 = nearest(*start); r1, c1 = nearest(*goal)
    ra, rb = max(1, min(r0, r1) - margin), min(Z.shape[0] - 2, max(r0, r1) + margin)
    ca, cb = max(1, min(c0, c1) - margin), min(Z.shape[1] - 2, max(c0, c1) + margin)
    nbr, edge = grid_cost(obj)
    horn_cache = {}
    dist = {(r0, c0): 0.0}; prev = {}; pq = [(0.0, (r0, c0))]
    while pq:
        g, u = heapq.heappop(pq)
        if g > dist.get(u, 1e300):
            continue
        if u == (r1, c1):
            break
        for di, dj in nbr:
            v = (u[0] + di, u[1] + dj)
            if not (ra <= v[0] <= rb and ca <= v[1] <= cb) or math.isnan(Z[v]):
                continue
            Lh = horn_cache.get(v)
            if Lh is None:
                Lh = horn_cache[v] = horn(*v)
            if math.isnan(Lh) or (Lh > CFG["smax"] and v != (r1, c1)):
                continue
            d, dz, s, _ = edge(u[0], u[1], v[0], v[1])
            if s > CFG["smax"]:
                continue
            ng = g + unit_cost(obj, d, dz, s, Lh)
            if ng < dist.get(v, 1e300):
                dist[v] = ng; prev[v] = u; heapq.heappush(pq, (ng, v))
    path = [(r1, c1)]
    while path[-1] in prev:
        path.append(prev[path[-1]])
    return path[::-1], dist[(r1, c1)]


def path_cost(obj, cells):
    nbr, edge = grid_cost(obj)
    tot = 0.0
    for (r, c), (rr, cc) in zip(cells[:-1], cells[1:]):
        d, dz, s, L = edge(r, c, rr, cc)
        tot += unit_cost(obj, d, dz, s, L)
    return tot


for obj, name in (("terrain", "terrain"), ("resource", "resource")):
    cells, best = dijkstra(obj, A, B)
    committed = [nearest(c["lat"], c["lon"]) for c in by[name]["coordinates"]]
    pc = path_cost(obj, committed)
    check(f"Independent Dijkstra confirms '{name}' route is cost-optimal", abs(pc - best) <= 1e-9 * max(1, best) or pc - best < 1e-6 * best,
          f"committed route cost {pc:.6f} vs independent optimum {best:.6f} ({'identical path' if cells == committed else 'different path, equal cost' if abs(pc-best) < 1e-9*max(1,best) else 'COST DIFFERS'})")

# 5 emergency: independent recomputation -----------------------------------------------------
inc = demo["incident"]; prog = inc["at_progress"]
battery = next(k["magnitude"] for k in inc["kinds"] if k["kind"] == "battery_loss") / 100
spd = next(k["magnitude"] for k in inc["kinds"] if k["kind"] == "speed_reduction") / 100
rt = snap["alternatives"]["recommended"]
R_ = indep[rt]
d, z = R_["d"], R_["z"]
al = R_["al"]
tot = sum(d); acc = 0.0; k = 0
while k < len(d) and acc + d[k] <= prog * tot + 1e-9:
    acc += d[k]; k += 1
f = 1 + CFG["cont"]
eff_done = sum(d[i] / sf(al[i]) for i in range(k)) / 1000
asc_done = sum(max(z[i + 1] - z[i], 0) for i in range(k))
t_done = eff_done / CFG["speed"]
climb = lambda a: CFG["mass"] * 3.71 * a / CFG["eff"] / 3.6e6
o2_used = t_done * CFG["crew"] * CFG["o2r"] * f
en_used = (t_done * CFG["kwhh"] + climb(asc_done)) * f
w_used = t_done / 24 * CFG["crew"] * CFG["wr"] * f
dose0 = t_done * CFG["rad"]
en_now = max(0.0, CFG["kwh"] * (1 - battery) - en_used)
o2_now, w_now = CFG["o2"] - o2_used, CFG["water"] - w_used
speed2 = CFG["speed"] * (1 - spd)
res = (CFG["o2"] * .2, CFG["kwh"] * .2, CFG["water"] * .2)


def finish(eff_rem, asc_rem, sci):
    t = eff_rem / speed2 + sci
    o2 = o2_now - t * CFG["crew"] * CFG["o2r"] * f
    en = en_now - (t * CFG["kwhh"] + climb(asc_rem)) * f
    w = w_now - t / 24 * CFG["crew"] * CFG["wr"] * f
    dose = dose0 + t * CFG["rad"]
    tt = t_done + t
    m = {"oxygen": (o2 - res[0]) / CFG["o2"], "energy": (en - res[1]) / CFG["kwh"], "water": (w - res[2]) / CFG["water"],
         "time": (CFG["hmax"] - tt) / CFG["hmax"], "radiation": (CFG["radmax"] - dose) / CFG["radmax"]}
    lim = min(m, key=m.get)
    return m[lim] * 100, lim, all(v >= 0 for v in m.values()), tt


# continue as planned: remaining outbound + science + full return
eff_rem = sum(d[i] / sf(al[i]) for i in range(k, len(d))) / 1000
asc_rem = sum(max(z[i + 1] - z[i], 0) for i in range(k, len(d)))
eff_full = sum(d[i] / sf(al[i]) for i in range(len(d))) / 1000
asc_ret = sum(max(z[i] - z[i + 1], 0) for i in range(len(d)))
sci_rt = CFG["sci"] + sum(s["dwell_hours"] for s in (by[rt].get("science_stops_visited") or []))
cont = finish(eff_rem + eff_full, asc_rem + asc_ret, sci_rt)
# abort: best of resource/terrain path from the incident point to base
here = R_["pts"][min(k, len(R_["pts"]) - 1)]
best_abort = None
for obj in ("resource", "terrain"):
    cells, _ = dijkstra(obj, here, A)
    pts = [center_latlon(*c) for c in cells]
    dd = [hav(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    zz = [Z[c] for c in cells]
    aa = [math.degrees(math.atan2(abs(zz[i + 1] - zz[i]), dd[i])) for i in range(len(dd))]
    e = sum(dd[i] / sf(aa[i]) for i in range(len(dd))) / 1000
    asc = sum(max(zz[i + 1] - zz[i], 0) for i in range(len(dd)))
    out = finish(e, asc, 0.0)
    if best_abort is None or out[0] > best_abort[0]:
        best_abort = out
sc = snap["scenario"]
rep_fail = sc["failure"]["limiting_margin_percent"]; rep_rev = sc["revised"]["limiting_margin_percent"]
check("Emergency FAILURE margin reproduces (headline −19.7%)", abs(cont[0] - rep_fail) < 1e-3 and not cont[2] and round(cont[0], 1) == -19.7,
      f"independent {cont[0]:.3f}% ({cont[1]}), feasible={cont[2]}; reported {rep_fail:.3f}%")
check("Emergency REVISED (abort) margin reproduces (headline +13.5%)", abs(best_abort[0] - rep_rev) < 1e-2 and best_abort[2] and round(best_abort[0], 1) == 13.5,
      f"independent {best_abort[0]:.3f}% ({best_abort[1]}), feasible={best_abort[2]}; reported {rep_rev:.3f}%")
orig = full_eval(indep[rt]["eff"], indep[rt]["ao"] + indep[rt]["ab"], sci_rt)
check("Consumption accounting (original mission)", abs((CFG["kwh"] - orig["en"]) - sc["original"]["energy_remaining_kwh"]) < 1e-4
      and abs((CFG["o2"] - orig["o2"]) - sc["original"]["oxygen_remaining_kg"]) < 1e-4 and abs((CFG["water"] - orig["w"]) - sc["original"]["water_remaining_liters"]) < 1e-4,
      f"O2 left {CFG['o2']-orig['o2']:.4f} kg, energy left {CFG['kwh']-orig['en']:.4f} kWh, water left {CFG['water']-orig['w']:.4f} L, time {orig['t']:.3f} h")

# 6 Monte Carlo ---------------------------------------------------------------------------------
sys.path.insert(0, str(ROOT))
import subprocess
code = ("import sys,json,warnings;warnings.filterwarnings('ignore');sys.path.insert(0,%r);from fastapi.testclient import TestClient;from api.main import app;"
        "d=json.load(open(%r));b={k:d[k] for k in ('origin','destination','science_stops','config')};"
        "r=TestClient(app).post('/api/risk/analyze',json={**b,'strategy':%r,'runs':d['runs'],'seed':d['seed']}).json();print(r['result_sha256'],r['fraction_satisfying_constraints'])"
        % (str(ROOT), str(ROOT / "api/data/demo_scenario.json"), rt))
outs = [subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, cwd=str(ROOT)).stdout.split() for _ in range(2)]
check("Monte Carlo (API path) deterministic across separate processes", outs[0] == outs[1] and len(outs[0]) == 2, f"hashes {outs[0][0][:16] if outs[0] else '?'} / {outs[1][0][:16] if outs[1] else '?'}")
rng = np.random.default_rng(12345)
N = 400_000
nz = lambda s, fl, cap=None: np.minimum(np.maximum(1 + rng.normal(0, s, N), fl), cap if cap else 1e9)
speed_f = nz(.15, .2); tt = rng.lognormal(-.5 * .1 ** 2, .1, N); ce = rng.lognormal(-.5 * .25 ** 2, .25, N)
o2f, enf, wf = nz(.12, .5), nz(.12, .5), nz(.12, .5); radf = nz(.25, .3); bat = nz(.05, .5, 1.0); delay = rng.triangular(0, .25, 2, N)
E = indep[rt]
effk = E["eff"] * tt * 2
t = effk / (CFG["speed"] * speed_f) + sci_rt + delay
climbk = CFG["mass"] * 3.71 * (E["ao"] + E["ab"]) * ce / CFG["eff"] / 3.6e6
o2 = t * CFG["crew"] * CFG["o2r"] * o2f * f; en = (t * CFG["kwhh"] * enf + climbk) * f; w = t / 24 * CFG["crew"] * CFG["wr"] * wf * f
dose = t * CFG["rad"] * radf
ok_ = ((CFG["o2"] - o2 >= CFG["o2"] * .2) & (CFG["kwh"] * bat - en >= CFG["kwh"] * .2) & (CFG["water"] - w >= CFG["water"] * .2) & (dose <= CFG["radmax"]) & (t <= CFG["hmax"]))
frac = ok_.mean(); rep = snap["risk"]["fraction_satisfying_constraints"]
se = math.sqrt(.75 * .25 / 3000)
check("Monte Carlo fraction reproduces with an independent implementation (different RNG stream)", abs(frac - rep) < 3 * se + 0.004,
      f"independent {frac:.4f} (N=400k) vs reported {rep:.4f} (N=3000, 1σ≈{se:.4f})")
check("Re-running the demo MC reproduces the committed snapshot hash", outs[0] and outs[0][0] == snap["risk"]["result_sha256"], f"{outs[0][0][:16] if outs[0] else '?'} vs {snap['risk']['result_sha256'][:16]}")

# ---------- summary ----------------------------------------------------------------------------
npass = sum(1 for _, ok, _ in results if ok)
print(f"\n{npass}/{len(results)} independent checks passed")
if "--md" in sys.argv:
    md = Path(sys.argv[sys.argv.index("--md") + 1])
    lines = ["# Independent validation results", "", "Generated by `scripts/validate_independent.py` (second implementation; same author; not external validation).", "",
             "| Check | Result | Detail |", "|---|---|---|"] + [f"| {n} | {'PASS' if ok else 'FAIL'} | {dtl} |" for n, ok, dtl in results] + ["", f"**{npass}/{len(results)} passed.**"]
    md.write_text("\n".join(lines) + "\n")
sys.exit(0 if npass == len(results) else 1)
