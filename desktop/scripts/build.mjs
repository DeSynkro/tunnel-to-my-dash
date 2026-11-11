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

await copyFile(path.join(root, "src/renderer/index.html"), path.join(dist, "renderer/index.html"));
await copyFile(path.join(root, "src/renderer/styles.css"), path.join(dist, "renderer/styles.css"));
await copyFile(path.join(root, "src/renderer/toolbar.html"), path.join(dist, "renderer/toolbar.html"));
await copyFile(path.join(root, "src/renderer/toolbar.css"), path.join(dist, "renderer/toolbar.css"));
