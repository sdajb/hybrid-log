# Hybrid Log 0.14.40 Patch Notes

## Summary

Version 0.14.40 is a large stability and logic update based on the latest Android build, then adapted for the GitHub Pages web version.

This release focuses on fixing workout planning crashes, improving diet-engine consistency, making nutrition targets easier to trust, and bringing the web app back in line with the current Android feature set.

## Major Changes

### 1. Plan Editing Stability

Fixed crashes that could occur while editing training plans.

The plan editor now handles saved programs, edited day plans, missing exercise fields, and older local data more safely. This should reduce cases where opening or modifying a plan could trigger a blank screen or runtime error.

### 2. Diet Engine Updates

The diet engine has been cleaned up so calorie and macro targets are more consistent across the app.

Key improvements:

- TDEE fallback logic is more reliable.
- Activity-level based TDEE is used on the web version.
- Android-only automatic step-counter logic is not exposed on web.
- Cut, maintenance, and gain targets are separated more clearly.
- Cheat-day handling is more stable.
- Protein targets are calculated using body weight or fat-free mass depending on body-fat context.

Protein logic:

- General case: body weight × 1.8g
- Higher body-fat case: fat-free mass × 2.0g
- Lean cutting case: fat-free mass × 2.6g

This avoids making protein targets unnecessarily high when body fat is elevated.

### 3. Nutrition Screen Fixes

The Eat screen has been updated to make calorie and macro information easier to interpret.

Fixes include:

- Macro bars now compare consumed intake against the actual target.
- Over-target macros are displayed more clearly.
- Calorie target, consumed calories, and remaining calories are more consistent.
- Removed misleading water-related copy where water tracking is not implemented.

### 4. Progress / Body Data Improvements

Progress calculations now better reflect the latest available body data.

Improvements include:

- Same-day body updates are handled more reliably.
- Latest body weight and body-fat estimates are synced more consistently.
- Progress screen values should better match recent updates from Today or body check-ins.

### 5. Workout Flow Improvements

Workout logging and guided lifting logic have been improved.

Changes include:

- Today’s planned workout opens more reliably.
- Deleted or missing program references are handled more safely.
- Manual workout input is more stable.
- Warm-up sets and working sets are handled more clearly.
- Exercise history lookup is more reliable by exercise ID, not only by name.
- Rest timer logic is more robust on Android.

### 6. Swipe / Navigation Stability

Fixed runtime errors related to horizontal swipe handling.

The app now includes the required drag-lock references and handles cancelled touch gestures more safely. This should prevent crashes such as:

```text
ReferenceError: dragLockedSlideRef is not defined
```

### 7. Web Version Adaptation

The web version is adapted from the Android 0.14.40 build with web-specific changes.

Web-specific changes:

- GitHub Pages base path set to `/hybrid-log/`
- Android native folder removed
- Android-only step counter hidden
- Activity Level is used for manual TDEE estimation
- GitHub Actions deployment workflow included
- Built `dist/` folder included

## Technical Notes

### Build

The web build was generated with:

```bash
npm run build
```

### GitHub Pages

The app is configured for:

```text
https://sdajb.github.io/hybrid-log/
```

Vite base:

```js
base: "/hybrid-log/"
```

### Local Data

This update does not move data to a server. Hybrid Log still stores data locally on each device/browser.

Existing local data should migrate where possible, but if old development data causes unexpected behaviour, clearing local app data may still be useful.

## Known Notes

- Web and Android data are separate because storage is local to each environment.
- The web version does not include automatic step tracking.
- Browser cache may keep an old bundle after deployment. Use a hard refresh if the site does not update immediately.
- Android native build verification should still be done separately in Android Studio when preparing an APK.

## Version

```text
Hybrid Log Web 0.14.40
Based on Android 0.14.40 plan edit crash fix
```

## 0.14.41 Web PWA Shortcut Fix

- Added a web app manifest for GitHub Pages.
- Fixed icon paths to use `/hybrid-log/` instead of the site root.
- Set PWA `start_url` and `scope` to `/hybrid-log/`.
- This prevents desktop/home-screen shortcuts from opening the wrong path and triggering a script error.

