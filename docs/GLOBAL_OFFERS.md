# Space Apps 2026 Global Offers — investigation record

| Offer / collaborator | What was verified | Decision |
|---|---|---|
| Page https://www.spaceappschallenge.org/2026/global-offers/ | Opened in the built-in browser on 2026-11-14: shows only "You must be logged in to view this content." No login attempted (credentials are the team's). | **Not read** |
| Google, Microsoft, Meteomatics, GoDaddy, Miro | Names appear as 2026 collaborators in public search snippets only; terms, credits, eligibility and expiry were **not verified**. | **Not activated, none assumed** |

Design rule applied: the demo **must not depend on promotional credits**. The API is a small FastAPI container (`render.yaml`, `api/Dockerfile`) that runs on any free container host; the web app is a static export. No cloud service materially improves the DEM workflow at this scale (two 1 MB windows; local rasterio). Cloud raster tooling (e.g. a COG on object storage, or GCP/Azure compute) would only matter when mounting many global windows, which is future work.
Meteomatics: Earth-weather products would be **misleading** as Mars atmosphere data and are not used. If the team can log in, record each offer's terms here and add an "activated/rejected + reason" row.
