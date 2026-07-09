# Hybrid Log Web / iOS PWA

This package can be deployed as a normal static web app and installed on iPhone/iPad from Safari.

## Build

```bash
npm install --no-package-lock
npm run build:web
```

The output is in `dist/`.

## Preview locally

```bash
npm run preview:web
```

Open the shown URL in a browser.

## Deploy

This ZIP is configured for a GitHub Pages project site at `/hybrid-log/`, for example `https://YOUR_GITHUB_ID.github.io/hybrid-log/`.

For iOS installation:
1. Open the deployed site in Safari.
2. Tap Share.
3. Tap “Add to Home Screen”.
4. Open Hybrid Log from the home screen.

## Notes

- Data is stored locally on the device/browser using local storage.
- The web app works offline after the first successful load through `public/sw.js`.
- Capacitor Android/iOS WebView builds intentionally do not register the service worker.
- Step tracking is intentionally hidden on the web/iOS PWA. Activity/TDEE uses the Activity Level chosen in settings. Native Android step counter support remains Android-only.


## GitHub Pages project-site setup

Create an empty public repository named:

```text
hybrid-log
```

Then push this project to:

```text
https://github.com/YOUR_GITHUB_ID/hybrid-log.git
```

In the repo settings, set:

```text
Settings → Pages → Source → GitHub Actions
```

The deployed URL will be:

```text
https://YOUR_GITHUB_ID.github.io/hybrid-log/
```

This version uses Vite `base: "/hybrid-log/"`, so it is intended for the repository name `hybrid-log`.
