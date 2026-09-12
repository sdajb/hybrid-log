# Fresh repository setup — Hybrid Log 0.15.4

This package is intended to be uploaded to a fresh `sdajb/hybrid-log` repository root.

## Important
- Do not upload `dist/` or `node_modules/`.
- GitHub Actions builds `dist/` automatically.
- This workflow intentionally does NOT enable `setup-node` npm caching, so a committed `package-lock.json` is not required.
- In GitHub: Settings → Pages → Source should be **GitHub Actions**.

## First push
```bash
git add -A
git commit -m "Fresh Hybrid Log 0.15.4 deploy"
git push origin main
```

Then open the Actions tab and wait for **Deploy Hybrid Log Web** to finish.
