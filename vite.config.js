import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Drops legacy .woff fallbacks from the build. Every Android WebView this
// app targets supports woff2, and shipping both roughly doubles the bundled
// font payload (~7MB of dead weight in the APK). This rewrites each CSS
// @font-face src to woff2-only and prevents the .woff files from emitting.
function woff2Only() {
  return {
    name: "woff2-only",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const [fileName, asset] of Object.entries(bundle)) {
        // Remove the .woff (not .woff2) font assets from the output.
        if (/\.woff$/.test(fileName)) {
          delete bundle[fileName];
          continue;
        }
        // Strip the ", url(...) format('woff')" fallback clause from CSS.
        if (fileName.endsWith(".css") && typeof asset.source === "string") {
          asset.source = asset.source.replace(
            /,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)/g,
            ""
          );
        }
      }
    },
  };
}

// PWA/service worker is intentionally disabled for the Capacitor build.
// Android runs the bundled files from android/app/src/main/assets/public,
// so a service worker is unnecessary and can fail under the WebView's
// https://localhost origin.
export default defineConfig({
  base: "/hybrid-log/",
  plugins: [
    react(),
    woff2Only(),
  ],
});
