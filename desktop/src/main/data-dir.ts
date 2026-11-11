import fs from "node:fs";
import path from "node:path";

export interface DataDirOptions {
  appPath: string;
  defaultUserData: string;
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
}

export function resolveDataRoot(options: DataDirOptions): string {
  if (options.env.TTMD_DATA_DIR) {
    return ensureWritable(options.env.TTMD_DATA_DIR);
  }

  const candidates: string[] = [];

  if (options.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(options.env.PORTABLE_EXECUTABLE_DIR, "tunnel-to-my-dash-data"));
  }
  if (options.env.APPIMAGE) {
    candidates.push(path.join(path.dirname(options.env.APPIMAGE), "tunnel-to-my-dash-data"));
  }
  if (!options.isPackaged) {
    candidates.push(path.resolve(options.appPath, "..", "local", "dev-data"));
  }
  candidates.push(path.join(options.defaultUserData, "data"));

  for (const candidate of candidates) {
    try {
      return ensureWritable(candidate);
    } catch {
      // Try the next location.
    }
  }

  return ensureWritable(options.defaultUserData);
}

function ensureWritable(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.accessSync(dir, fs.constants.W_OK);
  return path.resolve(dir);
}
