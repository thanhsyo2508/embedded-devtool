<#
.SYNOPSIS
  Bumps edt's version across package.json, Cargo.toml, and tauri.conf.json,
  commits, and tags — optionally pushing to trigger the release workflow.

.DESCRIPTION
  This script only does the mechanical part of a release (version bump,
  commit, tag). Write the CHANGELOG.md entry describing what changed
  *before* running this — see .claude/skills/release/SKILL.md.

.PARAMETER Version
  New version number, e.g. "0.1.1" (no leading "v").

.PARAMETER Push
  Also pushes the commit and tag to origin, which triggers
  .github/workflows/release.yml. Omitted by default, since pushing a tag is
  a public, hard-to-reverse action — review the local commit/tag first,
  then re-run with -Push (or push manually).

.EXAMPLE
  ./scripts/release.ps1 -Version 0.1.1
  ./scripts/release.ps1 -Version 0.1.1 -Push
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [switch]$Push
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Update-JsonVersion {
    param([string]$Path, [string]$Version)
    $content = Get-Content $Path -Raw
    $updated = $content -replace '("version"\s*:\s*)"[^"]*"', "`$1`"$Version`""
    Set-Content -Path $Path -Value $updated -NoNewline -Encoding utf8
}

function Update-TomlVersion {
    param([string]$Path, [string]$Version)
    $content = Get-Content $Path -Raw
    $updated = $content -replace '(?m)^(version\s*=\s*)"[^"]*"', "`$1`"$Version`""
    Set-Content -Path $Path -Value $updated -NoNewline -Encoding utf8
}

if (-not (Test-Path 'CHANGELOG.md') -or -not (Select-String -Path 'CHANGELOG.md' -Pattern ([regex]::Escape("## v$Version")) -Quiet)) {
    Write-Warning "CHANGELOG.md has no '## v$Version' section yet."
    Write-Warning "Write the changelog entry first (see .claude/skills/release/SKILL.md) — a version bump with no description of what changed is an incomplete release."
    exit 1
}

Write-Host "Bumping version to $Version..."
Update-JsonVersion -Path 'package.json' -Version $Version
Update-TomlVersion -Path 'src-tauri/Cargo.toml' -Version $Version
Update-JsonVersion -Path 'src-tauri/tauri.conf.json' -Version $Version

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
    Write-Host "Pushed. Check the repo's Actions tab for the release build."
}
else {
    Write-Host ""
    Write-Host "Not pushed. Review with:"
    Write-Host "  git show HEAD"
    Write-Host "  git tag -l v$Version"
    Write-Host "Then push with: git push origin HEAD && git push origin v$Version"
    Write-Host "(or re-run this script with -Push)"
}
