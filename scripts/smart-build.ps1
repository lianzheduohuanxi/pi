#!/usr/bin/env pwsh
#
# Smart build: detect changed files and run the shortest build path.
#
# Usage:
#   ./scripts/smart-build.ps1
#
# How it works:
#   - Runs `git status --porcelain` to find staged, unstaged, and untracked files
#   - Categories changes by area (deps, src, my-agent config, scripts)
#   - Chooses the minimal set of build-binaries.ps1 flags
#   - Falls back to full build on first run (no prior build output)
#
# Examples:
#   Changed my-agent/config only → skip deps, build, compile, tools; fast re-copy & re-zip
#   Changed src/ of a package    → skip deps, run build + compile + zip
#   Changed package.json         → full build (no skips)
#
# See Also:
#   scripts/build-binaries.ps1  — low-level build script with manual flags

param()

$ErrorActionPreference = 'Stop'

$RootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$BinDir = Join-Path $RootDir 'packages' 'coding-agent' 'binaries'
$WinDir = Join-Path $BinDir 'windows-x64'
Set-Location $RootDir

# ── 1. Detect changes ─────────────────────────────────────────────────

$statusLines = @(git status --porcelain)
if ($statusLines.Count -eq 0) {
    Write-Host 'No working tree changes detected.' -ForegroundColor Yellow
    Write-Host 'Nothing to build.' -ForegroundColor Cyan
    exit 0
}

$changedFiles = foreach ($line in $statusLines) {
    ($line -replace '^.. ').Trim()
} | Where-Object { $_ -ne '' }

Write-Host "==> Detected $($changedFiles.Count) changed file(s):" -ForegroundColor Cyan
foreach ($f in $changedFiles) { Write-Host "    $f" }

# ── 2. Categorize ────────────────────────────────────────────────────

$hasDeps    = $false  # package.json / package-lock.json / shrinkwrap
$hasSrc     = $false  # packages/*/src/ (not coding-agent)
$hasCASrc   = $false  # packages/coding-agent/src/
$hasMyAgent = $false  # my-agent/ (non-bin, non-ext, non-skill)
$hasBin     = $false  # my-agent/bin/
$hasExt     = $false  # my-agent/extensions/
$hasSkills  = $false  # my-agent/skills/
$hasPrompts = $false  # my-agent/prompts/
$hasScripts = $false  # scripts/

foreach ($file in $changedFiles) {
    $normalized = $file -replace '\\', '/'  # normalize to forward slash

    if ($normalized -match '^package\.json$' -or
        $normalized -match '^package-lock\.json$' -or
        $normalized -match 'npm-shrinkwrap') {
        $hasDeps = $true
    } elseif ($normalized -match '^packages/coding-agent/src/') {
        $hasCASrc = $true
    } elseif ($normalized -match '^packages/[^/]+/src/') {
        $hasSrc = $true
    } elseif ($normalized -match '^my-agent/bin/') {
        $hasBin = $true
        $hasMyAgent = $true
    } elseif ($normalized -match '^my-agent/extensions/') {
        $hasExt = $true
        $hasMyAgent = $true
    } elseif ($normalized -match '^my-agent/skills/') {
        $hasSkills = $true
        $hasMyAgent = $true
    } elseif ($normalized -match '^my-agent/prompts/') {
        $hasPrompts = $true
        $hasMyAgent = $true
    } elseif ($normalized -match '^my-agent/') {
        $hasMyAgent = $true
    } elseif ($normalized -match '^scripts/') {
        $hasScripts = $true
    }
}

# ── 3. Determine flags ───────────────────────────────────────────────
#
# Priority (most intensive wins when multiple areas changed):
#   deps > package src > coding-agent src > my-agent bin > my-agent config > scripts

$skipDeps     = $true
$skipBuild    = $true
$skipTools    = $true
$skipBundle   = $true
$skipInstaller = $false

$reason = @()

# Level 1: Dependency change — full rebuild
if ($hasDeps) {
    $skipDeps     = $false
    $skipBuild    = $false
    $skipTools    = $false
    $skipBundle   = $false
    $reason += 'dependency files changed — full rebuild'
}
# Level 2: Package source code changed — needs build + bundle
elseif ($hasSrc) {
    $skipDeps     = $true
    $skipBuild    = $false
    $skipTools    = $false
    $skipBundle   = $false
    $reason += 'package source changed — build + bundle required'
}
# Level 3: Coding-agent source changed — needs bundle only
elseif ($hasCASrc) {
    $skipDeps     = $true
    $skipBuild    = $true
    $skipTools    = $false
    $skipBundle   = $false
    $reason += 'coding-agent source changed — bundle required'
}
# Level 4: Binary tools changed — needs tool download + bundle
elseif ($hasBin) {
    $skipDeps     = $true
    $skipBuild    = $true
    $skipTools    = $false
    $skipBundle   = $false
    $reason += 'my-agent/bin changed — bundle + tool download required'
}
# Level 5: my-agent config/extension/skill/prompt changed — skip compile, keep tools
elseif ($hasMyAgent) {
    $skipDeps     = $true
    $skipBuild    = $true
    $skipTools    = $true
    $skipBundle   = $true
    $skipInstaller = $false
    $reason += 'my-agent config changed — skipping compile + tools'
}
# Level 6: Build scripts changed — skip everything, just re-package
elseif ($hasScripts) {
    $skipDeps     = $true
    $skipBuild    = $true
    $skipTools    = $true
    $skipBundle   = $true
    $reason += 'build scripts changed — re-package only'
}

# ── 4. Pre-flight check: ensure prior build output exists for skip-bundle ──

if ($skipBundle -and -not (Test-Path (Join-Path $WinDir 'pi.exe'))) {
    Write-Host "`n==> No prior build output found — forcing full bundle." -ForegroundColor Yellow
    $skipBundle = $false
    $reason[-1] = $reason[-1] -replace 'skipping compile', 'full compile (first build)'
}

# ── 5. Build flags string ────────────────────────────────────────────

$flags = @()
if ($skipDeps)     { $flags += '-SkipDeps' }
if ($skipBuild)    { $flags += '-SkipBuild' }
if ($skipTools)    { $flags += '-SkipTools' }
if ($skipBundle)   { $flags += '-SkipBundle' }
if ($skipInstaller) { $flags += '-SkipInstaller' }

$flagString = if ($flags.Count -gt 0) { " $($flags -join ' ')" } else { ' (full build)' }

Write-Host "`n==> $reason" -ForegroundColor Yellow
Write-Host "==> Running: build-binaries.ps1$flagString" -ForegroundColor Green
Write-Host ""

# ── 6. Execute ───────────────────────────────────────────────────────

& (Join-Path $PSScriptRoot 'build-binaries.ps1') @flags

# ── 7. Post-step: copy my-agent/bin/ from repo root if tools were skipped ──

if ($skipTools -and (Test-Path (Join-Path $RootDir 'my-agent' 'bin'))) {
    Write-Host "==> Copying my-agent/bin/ from repo root..." -ForegroundColor Cyan
    $repoBin = Join-Path $RootDir 'my-agent' 'bin'
    $outBin  = Join-Path $WinDir 'my-agent' 'bin'
    New-Item -ItemType Directory -Path $outBin -Force | Out-Null
    Get-ChildItem $repoBin -Filter '*.exe' | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $outBin $_.Name) -Force
        Write-Host "  Copied $($_.Name)" -ForegroundColor Green
    }
}

# ── 8. Final verification ────────────────────────────────────────────

Write-Host "`n==> Smart build complete." -ForegroundColor Green
