# Hybrid Log Web 0.15.5 — English Exercise Names

## Fix

The portfolio web build used English UI text but some sample exercise names
were still stored in Korean.

0.15.5 changes the portfolio demo dataset so exercise names are stored and
displayed in English by default while preserving Korean name metadata.

Examples:

- 인클라인/플랫 덤벨 프레스 → Incline / Flat DB Press
- 시티드 덤벨 숄더 프레스 → Seated DB Shoulder Press
- 스쿼트 → Squats
- 덤벨/바벨 로우 → DB / BB Row
- 풀업 또는 랫 풀다운 → Pull-Ups or Lat Pulldown

The portfolio demo seed schema is bumped to `v2`, so existing demo installs
are automatically re-seeded once after this update. Personal/non-demo data
is not overwritten.
