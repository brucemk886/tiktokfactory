#Requires -RunAsAdministrator
<#
.SYNOPSIS
  在主机（现在的 windows-local）上跑一次：把素材库、音频库只读共享出去，
  并导出一个 seed 文件夹（配置、素材索引、字幕缓存、密钥），给新工人机一键接入。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\worker-setup\primary-share.ps1
#>
param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$SeedDir = "D:\localfactory-data\worker-seed",
  # 能读共享的账号；默认只给当前登录账号。新机器用别的账号登录时，在新机器上跑 cmdkey 存这个账号的密码。
  [string]$ShareUser = "$env:USERDOMAIN\$env:USERNAME",
  # 只导出 seed，不建共享、不动防火墙（共享已手动建好时用）
  [switch]$SkipShare
)

$ErrorActionPreference = "Stop"

function To-WinPath([string]$value) { return ($value -replace "/", "\").TrimEnd("\") }

$configPath = Join-Path $Root "config.json"
if (-not (Test-Path $configPath)) { throw "找不到 $configPath，请在主机的仓库目录里跑。" }
# config.json 是 UTF-8 无 BOM，Windows PowerShell 默认按 ANSI 读会把中文路径读坏。
$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$videos = To-WinPath ($config.assetLibraryRoot)
$audio = To-WinPath ($config.audioLibraryRoot)
$work = To-WinPath ($config.workDir)
foreach ($dir in @($videos, $audio, $work)) {
  if (-not (Test-Path $dir)) { throw "目录不存在：$dir" }
}

function Ensure-Share([string]$name, [string]$path) {
  if ($SkipShare) { Write-Host "跳过共享 $name -> $path（-SkipShare）"; return }
  $existing = Get-SmbShare -Name $name -ErrorAction SilentlyContinue
  if ($existing) {
    if ((To-WinPath $existing.Path) -ne $path) { throw "共享 $name 已存在但指向 $($existing.Path)，不是 $path。先手动 Remove-SmbShare。" }
    Write-Host "共享已存在：\\$env:COMPUTERNAME\$name -> $path"
    return
  }
  New-SmbShare -Name $name -Path $path -ReadAccess $ShareUser -CachingMode None | Out-Null
  Write-Host "已共享（只读，$ShareUser）：\\$env:COMPUTERNAME\$name -> $path"
}

# 允许局域网访问共享：打开「文件和打印机共享」防火墙规则组（用组 ID，不受系统语言影响）。
if (-not $SkipShare) {
  Get-NetFirewallRule -Group "@FirewallAPI.dll,-28502" -ErrorAction SilentlyContinue | Enable-NetFirewallRule -ErrorAction SilentlyContinue
}
$publicProfiles = if ($SkipShare) { @() } else { Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq "Public" } }
foreach ($net in $publicProfiles) {
  try {
    Set-NetConnectionProfile -InterfaceIndex $net.InterfaceIndex -NetworkCategory Private
    Write-Host "网络「$($net.Name)」已从公用改为专用，否则共享连不上。"
  } catch {
    Write-Warning "网络「$($net.Name)」是公用网络且无法改成专用，共享可能连不上。"
  }
}

Ensure-Share "factory-videos" $videos
Ensure-Share "factory-audio" $audio

# seed：新机器只需要这些，publish-records / scheduled-tasks 等运行态不要带。
New-Item -ItemType Directory -Force -Path $SeedDir, (Join-Path $SeedDir "asset-library"), (Join-Path $SeedDir "audio-library") | Out-Null
Copy-Item $configPath (Join-Path $SeedDir "config.json") -Force
Copy-Item (Join-Path $work "asset-library\groups.json") (Join-Path $SeedDir "asset-library\groups.json") -Force
foreach ($name in @("official-tiktok-analytics-settings.json", "factory-cloud-worker.json")) {
  $source = Join-Path $work $name
  if (-not (Test-Path $source)) { throw "缺 $source" }
  Copy-Item $source (Join-Path $SeedDir $name) -Force
}
$audioIndex = Join-Path $work "audio-library\index.json"
if (Test-Path $audioIndex) { Copy-Item $audioIndex (Join-Path $SeedDir "audio-library\index.json") -Force }
$captionCache = Join-Path $work "caption-cache"
if (Test-Path $captionCache) {
  robocopy $captionCache (Join-Path $SeedDir "caption-cache") /MIR /NP /NJH /NJS /NFL /NDL | Out-Null
}
Copy-Item (Join-Path $PSScriptRoot "worker-bootstrap.ps1") (Join-Path $SeedDir "worker-bootstrap.ps1") -Force

$repoUrl = (& git -C $Root remote get-url origin 2>$null)
if (-not $repoUrl) { $repoUrl = "https://github.com/brucemk886/tiktokfactory.git" }
@{
  primaryHost = $env:COMPUTERNAME
  assetLibraryRoot = $config.assetLibraryRoot
  audioLibraryRoot = $config.audioLibraryRoot
  videosShare = "factory-videos"
  audioShare = "factory-audio"
  repoUrl = $repoUrl
  nodeVersion = ((& node -v 2>$null) -replace "^v", "")
  exportedAt = (Get-Date).ToString("s")
} | ConvertTo-Json | Set-Content (Join-Path $SeedDir "seed.json") -Encoding UTF8

Ensure-Share "factory-seed" $SeedDir

Write-Host ""
Write-Host "完成。seed 里有密钥，共享只给 $ShareUser 读。" -ForegroundColor Green
Write-Host "到新机器上，用管理员 PowerShell 执行："
Write-Host "  powershell -ExecutionPolicy Bypass -File \\$env:COMPUTERNAME\factory-seed\worker-bootstrap.ps1 -WorkerId windows-2" -ForegroundColor Cyan
Write-Host "新机器登录账号和这台不同时，加 -PrimaryUser '$ShareUser' -PrimaryPassword '<这台的登录密码>'。"
