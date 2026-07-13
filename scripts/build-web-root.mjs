import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const indexPath = path.join(root, "index.html");
const devIndexPath = path.join(root, "index.dev.html");
const distPath = path.join(root, "dist");
const assetsRootPath = path.join(root, "assets");

if (!fs.existsSync(devIndexPath)) {
  console.error("Missing index.dev.html. Cannot build safely.");
  process.exit(1);
}

const previousRootIndex = fs.existsSync(indexPath)
  ? fs.readFileSync(indexPath, "utf8")
  : "";

try {
  // Vite must build from the development HTML entry.
  // The repository root index.html is a prebuilt GitHub Pages entry,
  // so using it directly as Vite input causes Rollup to resolve
  // /hybrid-log/assets/*.js as source imports and fail.
  fs.writeFileSync(indexPath, fs.readFileSync(devIndexPath, "utf8"));

  fs.rmSync(distPath, { recursive: true, force: true });

  const viteBin = process.platform === "win32"
    ? path.join(root, "node_modules", ".bin", "vite.cmd")
    : path.join(root, "node_modules", ".bin", "vite");

  const result = spawnSync(viteBin, ["build"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    console.error("Build completed but dist/index.html was not created.");
    process.exit(1);
  }

  // After building, make the repository root deployable too.
  // This supports GitHub Pages configured as:
  // Deploy from a branch -> main -> /root
  const entries = fs.readdirSync(distPath, { withFileTypes: true });

  // Clean root-level generated assets before copying new dist output.
  fs.rmSync(assetsRootPath, { recursive: true, force: true });

  for (const entry of entries) {
    const from = path.join(distPath, entry.name);
    const to = path.join(root, entry.name);

    // Preserve source/development folders and project metadata.
    if (["src", "public", "scripts", ".github", "node_modules"].includes(entry.name)) {
      continue;
    }

    fs.rmSync(to, { recursive: true, force: true });

    if (entry.isDirectory()) {
      fs.cpSync(from, to, { recursive: true });
    } else {
      fs.copyFileSync(from, to);
    }
  }

  console.log("");
  console.log("Build complete.");
  console.log("dist/ was generated and copied to repo root for GitHub Pages /root deployment.");
} finally {
  // Keep root index as the production deploy index if build succeeded.
  // If Vite failed before creating dist/index.html, restore the previous root index.
  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    fs.writeFileSync(indexPath, previousRootIndex);
  }
}
