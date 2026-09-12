# Hybrid Log Web 0.15.2 — Portfolio Tour Export Hotfix

## Fix

0.15.1 accidentally placed the `PortfolioTour` component between `export default`
and the root `App()` declaration.

That made `PortfolioTour` the default export. Because the root render supplied no
`open` prop, the tour returned `null`, producing a blank page even though the
Vite/GitHub Actions build succeeded.

0.15.2 restores the intended structure:

```jsx
function PortfolioTour(...) {
  ...
}

export default function App() {
  ...
}
```

All 0.15.1 Portfolio Tour behaviour remains unchanged.
