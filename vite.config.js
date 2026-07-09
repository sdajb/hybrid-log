import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// PWA/service worker is intentionally disabled for the Capacitor build.
// Android runs the bundled files from android/app/src/main/assets/public,
// so a service worker is unnecessary and can fail under the WebView's
// https://localhost origin.
export default defineConfig({
  base: "/hybrid-log/",
  plugins: [
    react(),
  ],
});
