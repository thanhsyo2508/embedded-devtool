---
name: release
description: Bump edt's version, write a changelog entry describing what changed, and cut a tagged GitHub release. Use whenever the user asks to release/publish/cut a new version or bump the version number.
---

# Releasing a new version

The rule this skill exists to enforce: **a version bump must always come with a
human-readable description of what changed.** Never bump the version number
silently — a version number with no changelog entry is an incomplete release.

Follow these steps in order.

## 1. Confirm the version number

Semver: `MAJOR.MINOR.PATCH`. If the user didn't state one, ask. Check the
current version is consistent across all three places it's recorded:
- `package.json` (`"version"`)
- `src-tauri/Cargo.toml` (`[package] version`)
- `src-tauri/tauri.conf.json` (`"version"`)

These three must always match — if they don't already, that's a bug to flag
before proceeding, not something to silently paper over.

## 2. Gather what actually changed

Find the last release tag: `git tag -l 'v*' --sort=-v:refname | head -1`. Then
`git log <last-tag>..HEAD --oneline` to see every commit since. Read the real
diffs for anything you're unsure of — summarizing from commit titles alone
produces a changelog nobody can trust. If there is no prior tag (first
release), summarize everything the app currently does instead.

## 3. Write the changelog entry

Add a new section to the **top** of `CHANGELOG.md` (create the file, with an
`# Changelog` heading, if it doesn't exist yet) formatted as:

```markdown
## vX.Y.Z — YYYY-MM-DD

- Feature area: what changed, in plain terms a user of the app would
  recognize — not "refactored X" or "fixed bug in Y function".
- Group related changes under one bullet rather than one bullet per commit.
```

Write for someone using the app, not someone reading the diff. "Added a
topic-tree explorer, JSON syntax highlighting, and dynamic
subscribe/unsubscribe to the MQTT panel" beats "updated MqttPanel.tsx".

## 4. Bump the version number

Update all three files listed in step 1 to the same new value.

## 5. Keep README.md honest

If this release adds, removes, or meaningfully changes a user-facing
feature, update README.md's "What works today" section (and its "Not yet
built" list) so it doesn't drift out of date. Skip this step only if the
release is purely internal (build tooling, CI, refactors with no visible
behavior change).

## 6. Run the release script

Use `scripts/release.ps1 -Version X.Y.Z` to commit the version bump +
changelog + README changes, and create the `vX.Y.Z` tag. It does not push by
default — pass `-Push` only after confirming with the user (see step 7).

## 7. Confirm before pushing

Pushing the tag triggers `.github/workflows/release.yml`, which builds
signed installers on every platform and drafts a GitHub Release — visible
CI activity even though the release itself stays a draft. Confirm with the
user before running with `-Push`, unless they already explicitly asked for
the release to be cut in this same request.
