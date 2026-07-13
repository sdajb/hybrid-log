# Hybrid Log Web 0.14.41 Patch Notes

## Summary

This release fixes the GitHub Pages desktop/home-screen shortcut issue and makes patch notes available as static HTML pages.

## Open Patch Notes

After deployment, try these URLs:

```text
https://sdajb.github.io/hybrid-log/patch-notes.html
https://sdajb.github.io/hybrid-log/patch-notes-0.14.41.html
https://sdajb.github.io/hybrid-log/patch-notes-0.14.41/
```

## Required After Updating

Delete the old desktop/home-screen shortcut and create it again.

Old shortcuts may keep the previous path, icon metadata, or cached manifest. Updating the website alone may not update an already-created shortcut.

Recommended steps:

1. Delete the existing Hybrid Log shortcut from desktop/home screen.
2. Open `https://sdajb.github.io/hybrid-log/` in the browser.
3. Hard refresh once if needed.
4. Create the shortcut / install the app again.

## Changes

- Added proper PWA manifest.
- Set `start_url` to `/hybrid-log/`.
- Set `scope` to `/hybrid-log/`.
- Fixed icon paths to `/hybrid-log/icon-*.png`.
- Added visible static patch notes pages in multiple paths.

## 0.14.44 Root Deployment Fix

Patch notes opened but the main app did not open from:

```text
https://sdajb.github.io/hybrid-log/
```

That means GitHub Pages was serving the repository root instead of the built `dist` folder.

This package copies the production `dist` build to the repo root as well, so the app works with GitHub Pages set to:

```text
Deploy from a branch → main → /root
```

The original development `index.html` has been backed up as `index.dev.html`.
