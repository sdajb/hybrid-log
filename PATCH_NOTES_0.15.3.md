# Hybrid Log Web 0.15.3 — Clean Pages Deployment

This release removes the mixed root/dist deployment architecture.

## Deployment

There is now one canonical path:

```text
index.html + src/
→ vite build
→ dist/
→ GitHub Actions Pages
```

Removed from the repository source:

- committed root `assets/`
- committed `dist/`
- `index.dev.html`
- `scripts/build-web-root.mjs`
- duplicate root PWA/static copies

The canonical static files live in `public/` and are copied into `dist/` by Vite.

## Blank-page diagnostics

The source `index.html` contains a visible boot shell and pre-module error handlers.
If the JavaScript bundle cannot start, the page now shows a startup diagnostic
instead of a blank screen.

## Portfolio features retained

- English default
- relative-date sample data
- Portfolio Tour
- Replay Portfolio Tour
- Reset Demo Data
- PWA safe-area handling
