#!/usr/bin/env pwsh
#
# Build pi binaries for Windows x64 locally.
# Port of scripts/build-binaries.sh with Inno Setup installer generation.
#
# Usage:
#   ./scripts/build-binaries.ps1 [-SkipDeps] [-SkipBuild] [-SkipTools] [-SkipBundle] [-SkipInstaller]
#
# Options:
#   -SkipDeps       Skip npm ci and cross-platform dependency install
#   -SkipBuild      Skip npm run build
#   -SkipTools      Skip downloading fd.exe and rg.exe
#   -SkipBundle     Skip bun compile (keeps existing pi.exe, only refresh runtime files)
#   -SkipInstaller  Skip Inno Setup installer generation
#
# Smart build (auto-detect flags):
#   ./scripts/smart-build.ps1
#
# Output:
#   packages/coding-agent/binaries/
#     windows-x64/          Extracted distribution directory
#     pi-windows-x64.zip    ZIP archive
#     pi-windows-x64-setup-<ver>.exe   Inno Setup installer (optional)

param(
    [switch]$SkipDeps,
    [switch]$SkipBuild,
    [switch]$SkipTools,
    [switch]$SkipBundle,
    [switch]$SkipInstaller
)

$ErrorActionPreference = 'Stop'

# ── Paths ──────────────────────────────────────────────────────────────

$RootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$CodingAgentDir = Join-Path $RootDir 'packages' 'coding-agent'
$BinDir = Join-Path $CodingAgentDir 'binaries'
$WinDir = Join-Path $BinDir 'windows-x64'
$MyAgentBinDir = Join-Path $WinDir 'my-agent' 'bin'

Set-Location $RootDir

# ── Helper functions ───────────────────────────────────────────────────

function Get-FileSizeMB {
    param([string]$Path)
    if (Test-Path $Path) {
        $size = (Get-Item $Path).Length
        return '{0:N1}' -f ($size / 1MB)
    }
    return 'N/A'
}

# ── Step 1: Install dependencies ───────────────────────────────────────

if (-not $SkipDeps) {
    Write-Host '==> Installing dependencies...' -ForegroundColor Cyan
    npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }

    Write-Host '==> Installing cross-platform native bindings...' -ForegroundColor Cyan
    npm install --no-save --package-lock=false --force --ignore-scripts `
        '@mariozechner/clipboard-win32-x64-msvc@0.3.6'
    if ($LASTEXITCODE -ne 0) { throw 'npm install clipboard binding failed' }
} else {
    Write-Host '==> Skipping dependency install (-SkipDeps)' -ForegroundColor Yellow
}

# ── Step 2: Build ──────────────────────────────────────────────────────

if (-not $SkipBuild) {
    Write-Host '==> Building all packages...' -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
} else {
    Write-Host '==> Skipping package build (-SkipBuild)' -ForegroundColor Yellow
}

# ── Step 3: Bun compile ────────────────────────────────────────────────

if (-not $SkipBundle) {
    Write-Host '==> Compiling pi.exe with Bun...' -ForegroundColor Cyan

    # Ensure bun is available
    $bunCmd = Get-Command bun -ErrorAction SilentlyContinue
    if (-not $bunCmd) {
        Write-Host '  bun not found, installing globally...' -ForegroundColor Yellow
        npm install -g bun
        if ($LASTEXITCODE -ne 0) { throw 'bun install failed' }
        $bunCmd = Get-Command bun -ErrorAction SilentlyContinue
        if (-not $bunCmd) { throw 'bun still not found after install' }
    }

    # Clean previous builds
    if (Test-Path $WinDir) { Remove-Item $WinDir -Recurse -Force }
    New-Item -ItemType Directory -Path $WinDir -Force | Out-Null

    Push-Location $CodingAgentDir
    try {
        bun build --compile --target=bun-windows-x64 `
            ./dist/bun/cli.js `
            ./src/utils/image-resize-worker.ts `
            --outfile binaries/windows-x64/pi.exe
        if ($LASTEXITCODE -ne 0) { throw 'bun build failed' }
    } finally {
        Pop-Location
    }

    Write-Host '  pi.exe compiled' -ForegroundColor Green
} else {
    Write-Host '==> Skipping bun compile (-SkipBundle)' -ForegroundColor Yellow
    # Ensure output dir exists for subsequent copy steps
    if (-not (Test-Path $WinDir)) { throw 'No existing build output. Remove -SkipBundle for first build.' }
}

# ── Step 4: Copy runtime files ─────────────────────────────────────────

Write-Host '==> Copying runtime files...' -ForegroundColor Cyan

$nodeModulesDir = Join-Path $RootDir 'node_modules'

# package.json, README.md, CHANGELOG.md
Copy-Item (Join-Path $CodingAgentDir 'package.json') $WinDir -Force
Copy-Item (Join-Path $CodingAgentDir 'README.md') $WinDir -Force
Copy-Item (Join-Path $CodingAgentDir 'CHANGELOG.md') $WinDir -Force

# photon_rs_bg.wasm
Copy-Item (Join-Path $nodeModulesDir '@silvia-odwyer' 'photon-node' 'photon_rs_bg.wasm') $WinDir -Force

# theme/
$themeSrc = Join-Path $CodingAgentDir 'dist' 'modes' 'interactive' 'theme'
$themeDst = Join-Path $WinDir 'theme'
New-Item -ItemType Directory -Path $themeDst -Force | Out-Null
if (Test-Path $themeSrc) {
    Copy-Item (Join-Path $themeSrc '*.json') $themeDst -Force
}

# assets/
$assetsSrc = Join-Path $CodingAgentDir 'dist' 'modes' 'interactive' 'assets'
$assetsDst = Join-Path $WinDir 'assets'
New-Item -ItemType Directory -Path $assetsDst -Force | Out-Null
if (Test-Path $assetsSrc) {
    Copy-Item (Join-Path $assetsSrc '*') $assetsDst -Force -Recurse
}

# export-html/
$exportHtmlSrc = Join-Path $CodingAgentDir 'dist' 'core' 'export-html'
$exportHtmlDst = Join-Path $WinDir 'export-html'
if (Test-Path $exportHtmlSrc) {
    Copy-Item $exportHtmlSrc $exportHtmlDst -Force -Recurse
} else {
    New-Item -ItemType Directory -Path $exportHtmlDst -Force | Out-Null
}

# docs/
$docsSrc = Join-Path $CodingAgentDir 'docs'
$docsDst = Join-Path $WinDir 'docs'
if (Test-Path $docsSrc) {
    Copy-Item $docsSrc $docsDst -Force -Recurse
} else {
    New-Item -ItemType Directory -Path $docsDst -Force | Out-Null
}

# examples/
$examplesSrc = Join-Path $CodingAgentDir 'examples'
$examplesDst = Join-Path $WinDir 'examples'
if (Test-Path $examplesSrc) {
    Copy-Item $examplesSrc $examplesDst -Force -Recurse
} else {
    New-Item -ItemType Directory -Path $examplesDst -Force | Out-Null
}

# node_modules/@mariozechner/clipboard and clipboard-win32-x64-msvc
$nmDst = Join-Path $WinDir 'node_modules' '@mariozechner'
New-Item -ItemType Directory -Path $nmDst -Force | Out-Null

$clipboardSrc = Join-Path $nodeModulesDir '@mariozechner' 'clipboard'
$clipboardNativeSrc = Join-Path $nodeModulesDir '@mariozechner' 'clipboard-win32-x64-msvc'

if (Test-Path $clipboardSrc) {
    Copy-Item $clipboardSrc (Join-Path $nmDst 'clipboard') -Force -Recurse
}
if (Test-Path $clipboardNativeSrc) {
    Copy-Item $clipboardNativeSrc (Join-Path $nmDst 'clipboard-win32-x64-msvc') -Force -Recurse
}

# native/win32/prebuilds/win32-x64/win32-console-mode.node
$nativeSrc = Join-Path $RootDir 'packages' 'tui' 'native' 'win32' 'prebuilds' 'win32-x64' 'win32-console-mode.node'
$nativeDst = Join-Path $WinDir 'native' 'win32' 'prebuilds' 'win32-x64'
New-Item -ItemType Directory -Path $nativeDst -Force | Out-Null
if (Test-Path $nativeSrc) {
    Copy-Item $nativeSrc $nativeDst -Force
}

# ── my-agent config files ──────────────────────────────────────────────

$myAgentDst = Join-Path $WinDir 'my-agent'
New-Item -ItemType Directory -Path $myAgentDst -Force | Out-Null

# Source priority: repo root my-agent/ > dist/modes/interactive/my-agent/
$myAgentRootSrc = Join-Path $RootDir 'my-agent'
$myAgentDistSrc = Join-Path $CodingAgentDir 'dist' 'modes' 'interactive' 'my-agent'

# Config files: copy from repo root if present, then dist, otherwise create empty files
$configFiles = @('SYSTEM.md', 'AGENTS.md', 'COMMIT.md')
foreach ($file in $configFiles) {
    $dst = Join-Path $myAgentDst $file
    $rootSrc = Join-Path $myAgentRootSrc $file
    $distSrc = Join-Path $myAgentDistSrc $file
    if (Test-Path $rootSrc) {
        Copy-Item $rootSrc $dst -Force
    } elseif (Test-Path $distSrc) {
        Copy-Item $distSrc $dst -Force
    } else {
        New-Item -ItemType File -Path $dst -Force | Out-Null
    }
}

# obsidian-config.json and scheduler-tasks-example.json (referenced by ISS)
$optionalConfigFiles = @('obsidian-config.json', 'scheduler-tasks-example.json')
foreach ($file in $optionalConfigFiles) {
    $dst = Join-Path $myAgentDst $file
    $rootSrc = Join-Path $myAgentRootSrc $file
    $distSrc = Join-Path $myAgentDistSrc $file
    if (Test-Path $rootSrc) {
        Copy-Item $rootSrc $dst -Force
    } elseif (Test-Path $distSrc) {
        Copy-Item $distSrc $dst -Force
    } else {
        New-Item -ItemType File -Path $dst -Force | Out-Null
    }
}

# my-agent/extensions/ - prefer repo root, then dist
$extDst = Join-Path $myAgentDst 'extensions'
$extRootSrc = Join-Path $myAgentRootSrc 'extensions'
$extDistSrc = Join-Path $myAgentDistSrc 'extensions'
if (Test-Path $extRootSrc) {
    Remove-Item $extDst -Force -Recurse -ErrorAction SilentlyContinue
    Copy-Item $extRootSrc $extDst -Force -Recurse
} elseif (Test-Path $extDistSrc) {
    Remove-Item $extDst -Force -Recurse -ErrorAction SilentlyContinue
    Copy-Item $extDistSrc $extDst -Force -Recurse
} else {
    New-Item -ItemType Directory -Path $extDst -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $extDst '.gitkeep') -Force | Out-Null
}

# my-agent/skills/ - prefer repo root, then dist
$skillsDst = Join-Path $myAgentDst 'skills'
$skillsRootSrc = Join-Path $myAgentRootSrc 'skills'
$skillsDistSrc = Join-Path $myAgentDistSrc 'skills'
if (Test-Path $skillsRootSrc) {
    Remove-Item $skillsDst -Force -Recurse -ErrorAction SilentlyContinue
    Copy-Item $skillsRootSrc $skillsDst -Force -Recurse
} elseif (Test-Path $skillsDistSrc) {
    Remove-Item $skillsDst -Force -Recurse -ErrorAction SilentlyContinue
    Copy-Item $skillsDistSrc $skillsDst -Force -Recurse
} else {
    New-Item -ItemType Directory -Path $skillsDst -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $skillsDst '.gitkeep') -Force | Out-Null
}

# my-agent/prompts/ (referenced by ISS with skipifsourcedoesntexist)
$promptsDst = Join-Path $myAgentDst 'prompts'
$promptsRootSrc = Join-Path $myAgentRootSrc 'prompts'
$promptsDistSrc = Join-Path $myAgentDistSrc 'prompts'
if (Test-Path $promptsRootSrc) {
    Remove-Item $promptsDst -Force -Recurse -ErrorAction SilentlyContinue
    Copy-Item $promptsRootSrc $promptsDst -Force -Recurse
} elseif (Test-Path $promptsDistSrc) {
    Remove-Item $promptsDst -Force -Recurse -ErrorAction SilentlyContinue
    Copy-Item $promptsDistSrc $promptsDst -Force -Recurse
} else {
    New-Item -ItemType Directory -Path $promptsDst -Force | Out-Null
}

# upgrade.ps1 (referenced by ISS at root level)
$upgradeSrc = Join-Path $CodingAgentDir 'dist' 'upgrade.ps1'
$upgradeDst = Join-Path $WinDir 'upgrade.ps1'
if (Test-Path $upgradeSrc) {
    Copy-Item $upgradeSrc $upgradeDst -Force
} else {
    # Create minimal upgrade stub
    $upgradeContent = @'
# Pi Agent self-upgrade script
# This script downloads and installs the latest version of Pi Agent.
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Pi Agent"
)

Write-Host "Pi Agent upgrade script - placeholder" -ForegroundColor Yellow
Write-Host "Please download the latest installer from https://github.com/earendil-works/pi-mono/releases" -ForegroundColor Cyan
'@
    Set-Content -Path $upgradeDst -Value $upgradeContent -Encoding UTF8 -Force
}

# Ensure my-agent/bin directory exists (for tools if SkipTools was used)
New-Item -ItemType Directory -Path $MyAgentBinDir -Force | Out-Null

Write-Host '  Runtime files copied' -ForegroundColor Green

# ── Step 5: Download tools (fd, rg) ───────────────────────────────────

if (-not $SkipTools) {
    Write-Host '==> Downloading tools...' -ForegroundColor Cyan

    $toolsBinDir = Join-Path $WinDir 'my-agent' 'bin'
    New-Item -ItemType Directory -Path $toolsBinDir -Force | Out-Null

    # Download fd
    Write-Host '  Downloading fd...' -ForegroundColor Cyan
    $fdZipDir = Join-Path $env:TEMP 'fd-download'
    if (Test-Path $fdZipDir) { Remove-Item $fdZipDir -Recurse -Force }
    New-Item -ItemType Directory -Path $fdZipDir -Force | Out-Null

    gh release download -R sharkdp/fd -p 'fd-*-x86_64-pc-windows-msvc.zip' `
        -D $fdZipDir --clobber
    if ($LASTEXITCODE -ne 0) { throw 'fd download failed' }

    $fdZip = Get-ChildItem (Join-Path $fdZipDir '*.zip') | Select-Object -First 1
    $fdExtractDir = Join-Path $fdZipDir 'extracted'
    Expand-Archive -Path $fdZip.FullName -DestinationPath $fdExtractDir -Force
    $fdExe = Get-ChildItem -Path $fdExtractDir -Recurse -Filter 'fd.exe' |
        Select-Object -First 1
    if (-not $fdExe) { throw 'fd.exe not found in archive' }
    Copy-Item $fdExe.FullName (Join-Path $toolsBinDir 'fd.exe') -Force
    Write-Host '  fd.exe copied' -ForegroundColor Green

    # Download rg
    Write-Host '  Downloading rg...' -ForegroundColor Cyan
    $rgZipDir = Join-Path $env:TEMP 'rg-download'
    if (Test-Path $rgZipDir) { Remove-Item $rgZipDir -Recurse -Force }
    New-Item -ItemType Directory -Path $rgZipDir -Force | Out-Null

    gh release download -R BurntSushi/ripgrep -p 'ripgrep-*-x86_64-pc-windows-msvc.zip' `
        -D $rgZipDir --clobber
    if ($LASTEXITCODE -ne 0) { throw 'ripgrep download failed' }

    $rgZip = Get-ChildItem (Join-Path $rgZipDir '*.zip') | Select-Object -First 1
    $rgExtractDir = Join-Path $rgZipDir 'extracted'
    Expand-Archive -Path $rgZip.FullName -DestinationPath $rgExtractDir -Force
    $rgExe = Get-ChildItem -Path $rgExtractDir -Recurse -Filter 'rg.exe' |
        Select-Object -First 1
    if (-not $rgExe) { throw 'rg.exe not found in archive' }
    Copy-Item $rgExe.FullName (Join-Path $toolsBinDir 'rg.exe') -Force
    Write-Host '  rg.exe copied' -ForegroundColor Green
} else {
    Write-Host '==> Skipping tool downloads (-SkipTools)' -ForegroundColor Yellow
}

# ── Step 6: Create ZIP ─────────────────────────────────────────────────

Write-Host '==> Creating ZIP archive...' -ForegroundColor Cyan

$zipPath = Join-Path $BinDir 'pi-windows-x64.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Compress-Archive -Path (Join-Path $WinDir '*') -DestinationPath $zipPath -Force
$zipSize = Get-FileSizeMB $zipPath
Write-Host "  Created pi-windows-x64.zip ($zipSize MB)" -ForegroundColor Green

# ── Step 7: Create Inno Setup installer ────────────────────────────────

if (-not $SkipInstaller) {
    $isccPath = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
    if (Test-Path $isccPath) {
        Write-Host '==> Creating Inno Setup installer...' -ForegroundColor Cyan

        # Read version from package.json
        $pkgJson = Get-Content (Join-Path $CodingAgentDir 'package.json') -Raw |
            ConvertFrom-Json
        $version = $pkgJson.version

        $issFile = Join-Path $RootDir 'scripts' 'pi-setup.iss'
        & $isccPath $issFile "/DAppVersion=$version"
        if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed' }

        $installerPath = Join-Path $BinDir "pi-windows-x64-setup-$version.exe"
        if (Test-Path $installerPath) {
            $installerSize = Get-FileSizeMB $installerPath
            Write-Host "  Created pi-windows-x64-setup-$version.exe ($installerSize MB)" -ForegroundColor Green
        }
    } else {
        Write-Host '==> Skipping installer: Inno Setup 6 not found at expected path' -ForegroundColor Yellow
        Write-Host '    Install from https://jrsoftware.org/isdl.php' -ForegroundColor Yellow
    }
} else {
    Write-Host '==> Skipping installer (-SkipInstaller)' -ForegroundColor Yellow
}

# ── Step 8: Verification ───────────────────────────────────────────────

Write-Host ''
Write-Host '==> Verification' -ForegroundColor Cyan

$checks = @(
    @{ Name = 'pi.exe';         Path = (Join-Path $WinDir 'pi.exe') },
    @{ Name = 'my-agent/bin/fd.exe'; Path = (Join-Path $WinDir 'my-agent' 'bin' 'fd.exe') },
    @{ Name = 'my-agent/bin/rg.exe'; Path = (Join-Path $WinDir 'my-agent' 'bin' 'rg.exe') },
    @{ Name = 'node_modules/@mariozechner/clipboard-win32-x64-msvc/'; Path = (Join-Path $WinDir 'node_modules' '@mariozechner' 'clipboard-win32-x64-msvc') },
    @{ Name = 'native/win32/prebuilds/win32-x64/win32-console-mode.node'; Path = (Join-Path $WinDir 'native' 'win32' 'prebuilds' 'win32-x64' 'win32-console-mode.node') },
    @{ Name = 'photon_rs_bg.wasm'; Path = (Join-Path $WinDir 'photon_rs_bg.wasm') },
    @{ Name = 'my-agent/SYSTEM.md'; Path = (Join-Path $WinDir 'my-agent' 'SYSTEM.md') },
    @{ Name = 'my-agent/AGENTS.md'; Path = (Join-Path $WinDir 'my-agent' 'AGENTS.md') },
    @{ Name = 'my-agent/COMMIT.md'; Path = (Join-Path $WinDir 'my-agent' 'COMMIT.md') },
    @{ Name = 'upgrade.ps1'; Path = (Join-Path $WinDir 'upgrade.ps1') }
)

$allOk = $true
foreach ($check in $checks) {
    $exists = Test-Path $check.Path
    $status = if ($exists) { 'OK' } else { $allOk = $false; 'MISSING' }
    $color = if ($exists) { 'Green' } else { 'Red' }
    Write-Host "  [$status] $($check.Name)" -ForegroundColor $color
}

Write-Host ''
Write-Host "  ZIP:      pi-windows-x64.zip ($zipSize MB)" -ForegroundColor Cyan

$pkgJson2 = Get-Content (Join-Path $CodingAgentDir 'package.json') -Raw | ConvertFrom-Json
$installerCheck = Join-Path $BinDir "pi-windows-x64-setup-$($pkgJson2.version).exe"
if (Test-Path $installerCheck) {
    $instSize = Get-FileSizeMB $installerCheck
    Write-Host "  Installer: pi-windows-x64-setup-$($pkgJson2.version).exe ($instSize MB)" -ForegroundColor Cyan
}

Write-Host ''
if ($allOk) {
    Write-Host '==> Build complete! All checks passed.' -ForegroundColor Green
} else {
    Write-Host '==> Build complete with warnings. Some files are MISSING.' -ForegroundColor Yellow
}
