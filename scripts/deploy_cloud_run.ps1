<#
.SYNOPSIS
  Deploy the RedReturn API to Google Cloud Run (scales to zero; fast cold start with CPU boost).

.EXAMPLE
  .\scripts\deploy_cloud_run.ps1 -ProjectId my-project-123 -WebOrigin https://redreturn.vercel.app -AllowVercelPreviews

.NOTES
  Requires the Google Cloud CLI (gcloud), `gcloud auth login`, and billing enabled on the project
  (Cloud Run has a monthly free tier; the instance limit below keeps costs bounded).
  Re-run the same command to deploy a new version.
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$WebOrigin,      # your Vercel URL, e.g. https://redreturn.vercel.app
  [string]$Region = "us-central1",
  [switch]$AllowVercelPreviews                           # also accept https://*.vercel.app preview URLs
)
$ErrorActionPreference = "Stop"
$Repo = "redreturn"; $Service = "redreturn-api"
$WebOrigin = $WebOrigin.TrimEnd("/")
$Image = "$Region-docker.pkg.dev/$ProjectId/$Repo/$($Service):latest"
Set-Location (Split-Path $PSScriptRoot -Parent)          # repository root (cloudbuild.api.yaml, api/)

function Step([string]$Title, [scriptblock]$Command) {
  Write-Host "==> $Title" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "Failed: $Title (exit code $LASTEXITCODE)" }
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw "gcloud not found. Install the Google Cloud CLI first: winget install Google.CloudSDK" }

Step "Select project $ProjectId" { gcloud config set project $ProjectId }
Step "Enable Cloud Run, Cloud Build and Artifact Registry" { gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com }

gcloud artifacts repositories describe $Repo --location $Region *> $null
if ($LASTEXITCODE -ne 0) {
  Step "Create the image repository '$Repo' in $Region" { gcloud artifacts repositories create $Repo --repository-format docker --location $Region --description "RedReturn API images" }
}

Step "Build the API image with Cloud Build (3-8 min the first time)" { gcloud builds submit --config cloudbuild.api.yaml --substitutions "_REGION=$Region" . }

# Environment variables go through a YAML file: gcloud on Windows runs via cmd.exe, which mangles ^ and , in arguments.
$EnvFile = Join-Path ([System.IO.Path]::GetTempPath()) "redreturn-env.yaml"
$Lines = @("REDRETURN_CORS_ORIGINS: '$WebOrigin'")
if ($AllowVercelPreviews) { $Lines += "REDRETURN_CORS_ORIGIN_REGEX: 'https://.*\.vercel\.app'" }
Set-Content -Path $EnvFile -Value $Lines -Encoding ascii

Step "Deploy to Cloud Run ($Service, $Region)" {
  gcloud run deploy $Service --image $Image --region $Region --platform managed --allow-unauthenticated `
    --memory 1Gi --cpu 1 --cpu-boost --min-instances 0 --max-instances 2 --concurrency 20 --timeout 300 `
    --env-vars-file $EnvFile
}
Remove-Item $EnvFile -ErrorAction SilentlyContinue

$Url = (gcloud run services describe $Service --region $Region --format "value(status.url)").Trim()
Write-Host ""
Write-Host "API URL: $Url" -ForegroundColor Green
try {
  $Health = Invoke-RestMethod "$Url/api/health" -TimeoutSec 90
  Write-Host "Health check: $($Health.status)" -ForegroundColor Green
} catch {
  Write-Host "Health check failed (the first request can take a few seconds): $_" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Next: in Vercel -> Settings -> Environment Variables set NEXT_PUBLIC_API_URL = $Url, then Redeploy."
