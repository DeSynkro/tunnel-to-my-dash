import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "renderer"), { recursive: true });

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
};

await build({
  ...shared,
  entryPoints: [path.join(root, "src/main/main.ts")],
  outfile: path.join(dist, "main.js"),
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});

await build({
  ...shared,
  entryPoints: [path.join(root, "src/preload.ts")],
  outfile: path.join(dist, "preload.js"),
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});

await build({
  ...shared,
  entryPoints: [path.join(root, "src/toolbar-preload.ts")],
  outfile: path.join(dist, "toolbar-preload.js"),
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});

await build({
  ...shared,
  entryPoints: [path.join(root, "src/dashboard-preload.ts")],
  outfile: path.join(dist, "dashboard-preload.js"),
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});

await build({
  ...shared,
  entryPoints: [path.join(root, "src/error-preload.ts")],
  outfile: path.join(dist, "error-preload.js"),
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});

await build({
  ...shared,
  entryPoints: [path.join(root, "src/lock-preload.ts")],
  outfile: path.join(dist, "lock-preload.js"),
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});

await build({
  ...shared,
  entryPoints: [path.join(root, "src/renderer/app.ts")],
  outfile: path.join(dist, "renderer/app.js"),
  platform: "browser",
  format: "iife",
  target: "chrome120",
});

await build({
  ...shared,
  entryPoints: [path.join(root, "src/renderer/toolbar.ts")],
  outfile: path.join(dist, "renderer/toolbar.js"),
  platform: "browser",
  format: "iife",
  target: "chrome120",
});

await build({
  ...shared,
  entryPoints: [path.join(root, "src/renderer/lock.ts")],
  outfile: path.join(dist, "renderer/lock.js"),
  platform: "browser",
  format: "iife",
  target: "chrome120",
});

await build({
  ...shared,
  entryPoints: [path.join(root, "src/renderer/error.ts")],
  outfile: path.join(dist, "renderer/error.js"),
  platform: "browser",
  format: "iife",
  target: "chrome120",
});

await copyFile(path.join(root, "src/renderer/index.html"), path.join(dist, "renderer/index.html"));
await copyFile(path.join(root, "src/renderer/styles.css"), path.join(dist, "renderer/styles.css"));
await copyFile(path.join(root, "src/renderer/toolbar.html"), path.join(dist, "renderer/toolbar.html"));
await copyFile(path.join(root, "src/renderer/toolbar.css"), path.join(dist, "renderer/toolbar.css"));
await copyFile(path.join(root, "src/renderer/lock.html"), path.join(dist, "renderer/lock.html"));
await copyFile(path.join(root, "src/renderer/lock.css"), path.join(dist, "renderer/lock.css"));
await copyFile(path.join(root, "src/renderer/error.html"), path.join(dist, "renderer/error.html"));
await copyFile(path.join(root, "src/renderer/error.css"), path.join(dist, "renderer/error.css"));
await copyFile(
  path.join(root, "src/renderer/brand-mark.svg"),
  path.join(dist, "renderer/brand-mark.svg"),
);
await copyFile(path.join(root, "build/icon.png"), path.join(dist, "icon.png"));
