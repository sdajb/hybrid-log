# Hybrid Log Web 0.14.41 Patch Notes

## Summary

This release fixes the GitHub Pages desktop/home-screen shortcut issue.

The app itself was working from the normal browser URL, but shortcuts created on the desktop or home screen could open with the wrong path or cached metadata. That could cause a generic `Script error`.

## What Changed

### 1. PWA / Desktop Shortcut Fix

Added a proper web app manifest for the GitHub Pages deployment.

The manifest now uses:

```text
start_url: /hybrid-log/
scope: /hybrid-log/
```

This makes shortcuts open the correct app path instead of the site root.

### 2. Icon Path Fix

Shortcut and install icons now use GitHub Pages-safe paths:

```text
/hybrid-log/icon-192.png
/hybrid-log/icon-512.png
/hybrid-log/icon-maskable-192.png
/hybrid-log/icon-maskable-512.png
/hybrid-log/apple-touch-icon.png
```

Previously, some icon paths could resolve from the domain root instead of the project path.

### 3. Visible Patch Notes Page

Patch notes are now included as a static page that can be opened directly:

```text
https://sdajb.github.io/hybrid-log/patch-notes-0.14.41.html
```

## Required After Updating

If you already created a desktop or home-screen shortcut before this patch, delete the old shortcut and create it again.

The old shortcut may keep the previous path, icon metadata, or cached manifest. Updating the website alone may not update an already-created shortcut.

Recommended steps:

1. Delete the existing Hybrid Log shortcut from desktop/home screen.
2. Open the site again in the browser:

```text
https://sdajb.github.io/hybrid-log/
```

3. Hard refresh once if needed.
4. Create the shortcut / install the app again.

## Notes

- This does not change the diet engine.
- This does not change workout logic.
- Web and Android data are still separate because storage is local.
- Existing browser data should remain, but shortcut metadata may need to be recreated.

## Version

```text
Hybrid Log Web 0.14.41
PWA shortcut and visible patch notes fix
```
