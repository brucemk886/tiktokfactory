<#
.SYNOPSIS
  One-shot setup of a Local Factory worker machine from scratch.

.DESCRIPTION
  Nothing is copied from any other machine. The script installs Node/Git/ffmpeg
  when missing (winget), clones the repo, writes this machine's config from the
  repo's config.example.json plus the shared service keys the factory cloud
  already holds (fetched with the factory worker token), indexes this
  machine's own asset library, pushes its asset/audio catalogs to the factory,
  installs the watchdog scheduled task and checks the worker is up.

  The only secret you need is the factory's WORKER_TOKEN (Cloudflare secret of
  the tiktok-factory worker). It is the factory's credential, shared by every
  worker machine.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File setup-worker.ps1 -Token <WORKER_TOKEN> `
    -WorkerId worker-2 -Label "老家那台" -AssetRoot E:\视频素材 -AudioRoot E:\音频目录
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$WorkerId,
  [Parameter(Mandatory = $true)][string]$AssetRoot,
  [Parameter(Mandatory = $true)][string]$AudioRoot,
  [string]$Label = "",
  [string]$FactoryUrl = "https://factory.tiktokaitool.com",
  [string]$RepoDir = "D:\cursor\localfactory",
  [string]$DataDir = "D:\localfactory-data",
  [string]$RepoUrl = "https://github.com/brucemk886/tiktokfactory.git",
  [int]$RenderConcurrency = 2,
  [string]$ElevenLabsKey = "",
  [string]$DeskApiKey = "",
  [switch]$SkipInstallWatchdog
)

$ErrorActionPreference = "Stop"

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Ensure-Tool($command, $wingetId) {
  if (Get-Command $command -ErrorAction SilentlyContinue) { Write-Host "$command ok"; return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "$command is missing and winget is unavailable. Install $command manually, then rerun."
  }
  Write-Host "Installing $command via winget ($wingetId)..."
  winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements --silent | Out-Null
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command still not on PATH after install. Open a new terminal and rerun."
  }
}

if (-not (Test-Path $AssetRoot)) { throw "Asset root not found: $AssetRoot" }
if (-not (Test-Path $AudioRoot)) { throw "Audio root not found: $AudioRoot" }

Step "Checking Node, Git, ffmpeg"
Ensure-Tool node OpenJS.NodeJS.LTS
Ensure-Tool git Git.Git
Ensure-Tool ffmpeg Gyan.FFmpeg
Ensure-Tool ffprobe Gyan.FFmpeg

Step "Code -> $RepoDir"
if (-not (Test-Path (Join-Path $RepoDir ".git"))) {
  New-Item -ItemType Directory -Force (Split-Path $RepoDir) | Out-Null
  git clone $RepoUrl $RepoDir
} else {
  Push-Location $RepoDir
  git pull --ff-only
  Pop-Location
}
Push-Location $RepoDir
try {
  npm install --no-audit --no-fund

  Step "Writing config.json and worker settings (shared keys fetched from $FactoryUrl)"
  $bootArgs = @("scripts/worker-setup/bootstrap-worker.mjs", "--token", $Token, "--worker-id", $WorkerId,
    "--factory-url", $FactoryUrl, "--asset-root", $AssetRoot, "--audio-root", $AudioRoot, "--data-dir", $DataDir,
    "--render-concurrency", "$RenderConcurrency")
  if ($Label) { $bootArgs += @("--label", $Label) }
  if ($ElevenLabsKey) { $bootArgs += @("--elevenlabs-key", $ElevenLabsKey) }
  if ($DeskApiKey) { $bootArgs += @("--desk-api-key", $DeskApiKey) }
  node @bootArgs
  if ($LASTEXITCODE -ne 0) { throw "bootstrap-worker failed (exit $LASTEXITCODE)" }

  Step "Indexing $AssetRoot and pushing catalogs to the factory (probes every video, can take a while)"
  node scripts/worker-setup/index-and-push.mjs
  if ($LASTEXITCODE -ne 0) { throw "index-and-push failed (exit $LASTEXITCODE)" }

  if (-not $SkipInstallWatchdog) {
    Step "Installing watchdog scheduled task (LocalFactoryWatchdog)"
    npm run watchdog:install
    Step "Waiting for the worker on port 3010"
    $deadline = (Get-Date).AddSeconds(90)
    $up = $false
    while ((Get-Date) -lt $deadline) {
      try {
        Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3010/" -TimeoutSec 3 | Out-Null
        $up = $true
        break
      } catch { Start-Sleep -Seconds 3 }
    }
    if ($up) {
      Write-Host "Worker is up. Status file: $DataDir\work\factory-watchdog.json" -ForegroundColor Green
    } else {
      Write-Warning "Port 3010 did not answer within 90s. Check $DataDir\work\factory-watchdog.log and server-crash.log."
    }
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Done. In the factory task form pick machine '$WorkerId'; only that machine's asset groups and audio folders are listed." -ForegroundColor Green
