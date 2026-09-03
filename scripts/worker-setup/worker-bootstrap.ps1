#Requires -RunAsAdministrator
<#
.SYNOPSIS
  新工人机一键接入。从主机的 \\主机\factory-seed 直接运行：
    powershell -ExecutionPolicy Bypass -File \\主机\factory-seed\worker-bootstrap.ps1 -WorkerId windows-2

  做的事：装 Node 22 / Git / ffmpeg（缺什么装什么）→ 克隆仓库 → npm install →
  按 seed 生成 config.json、素材索引（路径指向主机共享）、factory-cloud-worker.json →
  启动一次确认接入 → 注册守护计划任务。
#>
param(
  [string]$WorkerId = "windows-2",
  [string]$Root = "D:\cursor\localfactory",
  [string]$DataDir = "D:\localfactory-data",
  # 主机名；默认从本脚本所在的 \\主机\factory-seed 路径推出来
  [string]$Primary = "",
  # 新机器登录账号与主机不同时，用主机的账号密码访问共享
  [string]$PrimaryUser = "",
  [string]$PrimaryPassword = "",
  [string]$RenderTypes = "auto-task,reddit-mix",
  [int]$RenderConcurrency = 2,
  [switch]$SkipInstall,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$seedDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Primary) {
  if ($seedDir -match '^\\\\([^\\]+)\\') { $Primary = $Matches[1] }
  else { throw "请从 \\主机\factory-seed\worker-bootstrap.ps1 运行，或传 -Primary 主机名。" }
}

function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

Step "访问主机共享 \\$Primary"
if ($PrimaryUser) {
  cmdkey /add:$Primary /user:$PrimaryUser /pass:$PrimaryPassword | Out-Null
  Write-Host "已保存访问 $Primary 的凭据（cmdkey）。"
}
$seed = Get-Content (Join-Path $seedDir "seed.json") -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($share in @($seed.videosShare, $seed.audioShare)) {
  $unc = "\\$Primary\$share"
  if (-not (Test-Path $unc)) { throw "访问不到 $unc。确认主机已跑 primary-share.ps1、两台在同一局域网；账号不同时加 -PrimaryUser/-PrimaryPassword。" }
  Write-Host "可访问：$unc"
}

if (-not $SkipInstall) {
  Step "安装基础软件"
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "没有 winget（Windows 10 1809+ 自带「应用安装程序」）。先从 Microsoft Store 装 App Installer。" }

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements --silent
    Refresh-Path
  }
  Write-Host "git: $(git --version)"

  $wantNode = if ($seed.nodeVersion) { [string]$seed.nodeVersion } else { "22.16.0" }
  $haveNode = (Get-Command node -ErrorAction SilentlyContinue)
  $haveMajor = if ($haveNode) { [int](((& node -v) -replace "^v", "") -split "\.")[0] } else { 0 }
  $wantMajor = [int]($wantNode -split "\.")[0]
  if ($haveMajor -ne $wantMajor) {
    # winget 上只剩当前 LTS（24.x），主机在跑 22，直接装 nodejs.org 的同版本 MSI 保持一致。
    $msi = Join-Path $env:TEMP "node-v$wantNode-x64.msi"
    Write-Host "下载 Node v$wantNode ..."
    Invoke-WebRequest "https://nodejs.org/dist/v$wantNode/node-v$wantNode-x64.msi" -OutFile $msi -UseBasicParsing
    $install = Start-Process msiexec.exe -ArgumentList "/i", "`"$msi`"", "/qn", "/norestart" -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "Node 安装失败，msiexec 退出码 $($install.ExitCode)。" }
    Refresh-Path
  }
  Write-Host "node: $(node -v)  npm: $(npm -v)"

  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements --silent
    Refresh-Path
  }
  Write-Host "ffmpeg: $((ffmpeg -version | Select-Object -First 1))"
  $nvenc = (ffmpeg -hide_banner -encoders 2>$null | Select-String "h264_nvenc")
  if ($nvenc) { Write-Host "检测到 NVENC，可以把 -RenderConcurrency 提到 3–4。" } else { Write-Host "未检测到 NVENC，走 CPU 编码。" }
}

Step "代码 $Root"
if (-not (Test-Path (Join-Path $Root ".git"))) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Root) | Out-Null
  git clone $seed.repoUrl $Root
} else {
  git -C $Root pull --ff-only
}
Push-Location $Root
try {
  npm install --no-audit --no-fund
} finally { Pop-Location }

Step "按 seed 生成配置"
$applyArgs = @(
  (Join-Path $Root "scripts\worker-setup\apply-seed.mjs"),
  "--seed", $seedDir, "--root", $Root, "--data", $DataDir, "--primary", $Primary,
  "--worker-id", $WorkerId, "--render-types", $RenderTypes, "--render-concurrency", $RenderConcurrency
)
if ($Force) { $applyArgs += "--force" }
& node @applyArgs
if ($LASTEXITCODE -ne 0) { throw "apply-seed 失败。" }

Step "启动一次确认接入工厂云"
$workDir = Join-Path $DataDir "work"
$out = Join-Path $workDir "bootstrap-smoke.log"
$err = Join-Path $workDir "bootstrap-smoke.err.log"
$proc = Start-Process node -ArgumentList "scripts/server.js" -WorkingDirectory $Root -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 25
$log = (Get-Content $out -Raw -ErrorAction SilentlyContinue) + (Get-Content $err -Raw -ErrorAction SilentlyContinue)
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
if ($log -notmatch "worker=$([regex]::Escape($WorkerId))") {
  Write-Host $log
  throw "没看到「工厂云工人已接入 … worker=$WorkerId」，检查上面的日志。"
}
Write-Host "已接入：worker=$WorkerId"

Step "注册守护（开机自启）"
Push-Location $Root
try { npm run watchdog:install } finally { Pop-Location }
Start-Sleep -Seconds 12
$state = Join-Path $workDir "factory-watchdog.json"
if (Test-Path $state) { Write-Host (Get-Content $state -Raw) }

Write-Host ""
Write-Host "完成。这台机器现在是工人 $WorkerId，只接 $RenderTypes，成片发布由它自己提交。" -ForegroundColor Green
Write-Host "素材从 \\$Primary\$($seed.videosShare) 读，音频从 \\$Primary\$($seed.audioShare) 读，主机新增的素材/音频这里立刻可见。"
Write-Host "重启工人：Stop-Process 掉 scripts/server.js 的 node 进程，守护 10 秒内拉起。"
