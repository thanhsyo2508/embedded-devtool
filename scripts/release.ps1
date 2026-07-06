<#
.SYNOPSIS
  Bumps edt version across package.json, Cargo.toml, and tauri.conf.json,
  commits, and tags -- optionally pushing to trigger the release workflow.

.DESCRIPTION
  This script only does the mechanical part of a release (version bump,
  commit, tag). Write the CHANGELOG.md entry describing what changed
  before running this -- see .claude/skills/release/SKILL.md.

.PARAMETER Version
  New version number, e.g. "0.1.1" (no leading v).

.PARAMETER Push
  Also pushes the commit and tag to origin, which triggers
  .github/workflows/release.yml. Omitted by default, since pushing a tag
  is a public, hard to reverse action -- review the local commit/tag
  first, then re-run with -Push (or push manually).

.EXAMPLE
  ./scripts/release.ps1 -Version 0.1.1
  ./scripts/release.ps1 -Version 0.1.1 -Push
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^\d+\.\d+\.\d+$")]
    [string]$Version,

    [switch]$Push
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Update-JsonVersion {
    param([string]$Path, [string]$Version)
    $content = Get-Content $Path -Raw
    $replacement = '$1"' + $Version + '"'
    $updated = $content -replace '("version"\s*:\s*)"[^"]*"', $replacement
    # Set-Content -Encoding utf8 writes a BOM in Windows PowerShell 5.1,
    # which breaks Rust's JSON/TOML parsers (both files here get read by
    # cargo) -- write UTF-8 without a BOM explicitly instead.
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Resolve-Path $Path), $updated, $utf8NoBom)
}

function Update-TomlVersion {
    param([string]$Path, [string]$Version)
    $content = Get-Content $Path -Raw
    $replacement = '$1"' + $Version + '"'
    $pattern = '(?m)^(version\s*=\s*)"[^"]*"'
    $updated = $content -replace $pattern, $replacement
    # Set-Content -Encoding utf8 writes a BOM in Windows PowerShell 5.1,
    # which breaks Rust's JSON/TOML parsers (both files here get read by
    # cargo) -- write UTF-8 without a BOM explicitly instead.
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Resolve-Path $Path), $updated, $utf8NoBom)
}

$changelogMarker = "## v" + $Version
$hasChangelog = (Test-Path "CHANGELOG.md") -and (Select-String -Path "CHANGELOG.md" -Pattern ([regex]::Escape($changelogMarker)) -Quiet)
if (-not $hasChangelog) {
    Write-Warning "CHANGELOG.md has no $changelogMarker section yet."
    Write-Warning "Write the changelog entry first (see .claude/skills/release/SKILL.md) -- a version bump with no description of what changed is an incomplete release."
    exit 1
}

Write-Host "Bumping version to $Version..."
Update-JsonVersion -Path "package.json" -Version $Version
Update-TomlVersion -Path "src-tauri/Cargo.toml" -Version $Version
Update-JsonVersion -Path "src-tauri/tauri.conf.json" -Version $Version

Write-Host "Refreshing package-lock.json..."
npm install --package-lock-only | Out-Null

Write-Host "Refreshing Cargo.lock..."
cargo check --manifest-path src-tauri/Cargo.toml --quiet

git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md README.md
git commit -m "Release v$Version"
git tag -a "v$Version" -m "v$Version"

Write-Host "Committed and tagged v$Version locally."

if ($Push) {
    Write-Host "Pushing commit and tag to origin (this triggers the release workflow)..."
    git push origin HEAD
    git push origin "v$Version"
    Write-Host "Pushed. Check GitHub Actions for the release build."
}
else {
    Write-Host ""
    Write-Host "Not pushed. Review with:"
    Write-Host "  git show HEAD"
    Write-Host "  git tag -l v$Version"
    Write-Host "Then push with: git push origin HEAD && git push origin v$Version"
    Write-Host "(or re-run this script with -Push)"
}
