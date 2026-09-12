# Hybrid Log Web 0.15.4 — Fresh Repository Deployment Reset

- Rebuilt the GitHub Pages deployment workflow from a clean baseline.
- Removed `setup-node` npm caching, which was failing because no dependency lock file was committed.
- The workflow now installs dependencies directly, builds with Vite, verifies `dist/`, and deploys only the generated `dist/` artifact.
- No generated `dist/` or root build assets are included in the repository.
