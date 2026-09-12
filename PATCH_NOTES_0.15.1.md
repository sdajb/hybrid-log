# Hybrid Log Web 0.15.1 — Portfolio Tour

## Portfolio Tour

The portfolio web build now explains the product before handing the visitor the interactive demo.

### First visit flow

1. **Hybrid Log**
   - Explains the product as one local-first fitness system.
   - Introduces the Track → Plan → Learn → Adjust loop.

2. **Product Map**
   - TODAY — calories, training, recovery and body metrics
   - ACT — strength and running logs with progression
   - EAT — nutrition, calories and macros
   - PLAN — weekly training and adaptive calorie targets
   - PROGRESS — weight, body-fat and TDEE trends

3. **Build**
   - React + Vite
   - Capacitor
   - Android + Web/PWA
   - Local-first / offline-first storage
   - TDEE calibration, macro logic and progressive overload

4. **Demo Mode**
   - Explains that the visible records are sample data.
   - Encourages the visitor to edit and explore.
   - Explains Reset Demo Data and Replay Portfolio Tour.

### Behaviour

The tour opens automatically only when it has not been seen before.

```text
hybridLog.portfolioTourSeen.v1
```

`Skip` and `Explore Hybrid Log` both mark the tour as seen.

The tour can always be opened again from:

```text
Settings → Portfolio Demo → Replay Portfolio Tour
```

The existing English default, relative-date sample data, demo badge, PWA safe-area fixes and GitHub Pages deployment remain unchanged.
