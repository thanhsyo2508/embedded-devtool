<#
.SYNOPSIS
  Bumps edt version across package.json, Cargo.toml, and tauri.conf.json,
  commits, tags, builds a local installer, and (optionally) pushes to
  trigger the signed cross-platform release workflow.

.DESCRIPTION
  This script does the mechanical part of a release (version bump,
  commit, tag, local build). Write the CHANGELOG.md entry describing
  what changed before running this -- see .claude/skills/release/SKILL.md.

  Two different, mutually exclusive ways to actually publish:

  -Push pushes the commit AND the tag to origin. Pushing the tag is what
  triggers .github/workflows/release.yml, which builds SIGNED installers
  for every platform in CI (where the signing key lives as a secret) and
  drafts a GitHub Release with them plus the updater's latest.json. This
  is the right choice for a real release meant to reach users via
  auto-update.

  -Publish pushes only the commit, then uses the (locally authenticated)
  gh CLI to create the GitHub Release directly -- attaching the
  installer(s) this script just built locally. That local build is
  UNSIGNED (no private key on this machine) and Windows-only, so this is
  for a fast, one-command draft release, not one auto-update will trust.
  Creating a release via `gh`/the API fires a `create`/`release` event,
  not a `push` event, so it does NOT also trigger release.yml -- the two
  paths don't collide as long as you don't also push the tag yourself.

.PARAMETER Version
  New version number, e.g. "0.1.1" (no leading v).

.PARAMETER SkipBuild
  Skip the local `tauri build` step (just bump/commit/tag). Useful when
  iterating on the version-bump mechanics without waiting for a full build.
  Incompatible with -Publish, which needs the local build to attach.

.PARAMETER Push
  Push the commit and tag to origin, triggering the signed,
  cross-platform CI release build. See .DESCRIPTION.

.PARAMETER Publish
  Create the GitHub Release directly via the gh CLI (must already be
  authenticated -- run `gh auth login` yourself first), attaching the
  local unsigned Windows installer as a draft. See .DESCRIPTION.

.EXAMPLE
  ./scripts/release.ps1 -Version 0.1.1
  ./scripts/release.ps1 -Version 0.1.1 -Push
  ./scripts/release.ps1 -Version 0.1.1 -Publish
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^\d+\.\d+\.\d+$")]
    [string]$Version,

    [switch]$SkipBuild,

    [switch]$Push,

    [switch]$Publish
)

if ($Push -and $Publish) {
    Write-Error "-Push and -Publish are mutually exclusive -- pick the signed CI release (-Push) or the local unsigned draft (-Publish), not both."
    exit 1
}

if ($Publish -and $SkipBuild) {
    Write-Error "-Publish needs the local build to attach as a release asset -- remove -SkipBuild."
    exit 1
}

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

if ($SkipBuild) {
    Write-Host "Skipping local build (-SkipBuild)."
}
else {
    Write-Host ""
    Write-Host "Building local installer (unsigned, for local testing -- the signed release build happens in CI)..."
    npm run tauri build
    $buildExitCode = $LASTEXITCODE

    # tauri build still exits non-zero here even when the installers come
    # out fine: createUpdaterArtifacts also tries to produce a signed
    # updater package, which needs TAURI_SIGNING_PRIVATE_KEY -- only set as
    # a GitHub Actions secret, never locally. So judge success by whether
    # the installer actually exists, not by the process exit code alone.
    $bundleRoot = "src-tauri/target/release/bundle"
    $installers = Get-ChildItem -Path $bundleRoot -Recurse -Include "*.exe", "*.msi" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*$Version*" }

    if ($installers) {
        Write-Host ""
        if ($buildExitCode -ne 0) {
            Write-Host "Installer(s) built for v$Version (the updater-signing step failed afterward, as expected without a local signing key -- CI signs the real release build):"
        }
        else {
            Write-Host "Built installer(s) for v$Version :"
        }
        foreach ($installer in $installers) {
            Write-Host "  $($installer.FullName)"
        }
    }
    else {
        Write-Warning "Build failed and no installer matching v$Version was found under $bundleRoot -- check the build output above."
        exit 1
    }
}

if ($Push) {
    Write-Host "Pushing commit and tag to origin (this triggers the release workflow)..."
    git push origin HEAD
    git push origin "v$Version"
    Write-Host "Pushed. Check GitHub Actions for the release build."
}
elseif ($Publish) {
    $ghAuthed = (gh auth status 2>&1 | Out-String) -match "Logged in to"
    if (-not $ghAuthed) {
        Write-Error "gh is not authenticated -- run 'gh auth login' yourself first (see .claude/skills/release/SKILL.md)."
        exit 1
    }

    Write-Host ""
    Write-Host "Pushing commit only (not the tag) so GitHub knows about it..."
    git push origin HEAD
    $commitSha = git rev-parse HEAD

    Write-Host "Creating GitHub Release v$Version via gh CLI (draft, unsigned, Windows-only)..."

    # Pull this version's own section out of CHANGELOG.md for the release
    # body, instead of dumping the whole file or leaving it blank.
    $changelogText = Get-Content "CHANGELOG.md" -Raw
    $sectionPattern = "(?ms)^## v" + [regex]::Escape($Version) + ".*?(?=^## v|\z)"
    $sectionMatch = [regex]::Match($changelogText, $sectionPattern)
    $notesPath = [System.IO.Path]::GetTempFileName()
    if ($sectionMatch.Success) {
        Set-Content -Path $notesPath -Value $sectionMatch.Value -NoNewline
    }
    else {
        Set-Content -Path $notesPath -Value "See CHANGELOG.md." -NoNewline
    }

    # --target is only valid when the tag doesn't exist on the remote yet
    # -- if it's already there (e.g. re-running -Publish for a version
    # that was tagged/pushed earlier), passing --target conflicts with
    # the tag's real commit and gh rejects it with a 422.
    $tagExistsRemotely = [bool](git ls-remote --tags origin "refs/tags/v$Version")

    $installerPaths = $installers | ForEach-Object { $_.FullName }
    if ($tagExistsRemotely) {
        gh release create "v$Version" @installerPaths --title "v$Version" --notes-file $notesPath --draft
    }
    else {
        gh release create "v$Version" @installerPaths --target $commitSha --title "v$Version" --notes-file $notesPath --draft
    }

    Remove-Item $notesPath -Force

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Draft release created. Review it on GitHub, then publish when ready."
    }
    else {
        Write-Error "gh release create failed -- see output above. The local tag/commit are still fine; re-run with -Publish once fixed."
        exit 1
    }
}
else {
    Write-Host ""
    Write-Host "Not published. Review the local commit/tag/build, then either:"
    Write-Host "  Re-run with -Push    -> signed, cross-platform release via CI"
    Write-Host "  Re-run with -Publish -> fast local unsigned draft release via gh CLI"
}
