import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppSettings } from "../shared/types";

const defaults: AppSettings = {
  open_last_dashboard: false,
};

export class SettingsStore {
  private readonly filePath: string;
  private settings: AppSettings = { ...defaults };

  constructor(private readonly dataRoot: string) {
    this.filePath = path.join(dataRoot, "settings.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.settings = normalize(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[settings] ${message}`);
      }
      this.settings = { ...defaults };
    }
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = normalize({ ...this.settings, ...patch });
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });

    const temporary = `${this.filePath}.tmp`;
    const body = `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`;
    await writeFile(temporary, body, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);

    this.settings = next;
    return this.get();
  }
}

function normalize(value: unknown): AppSettings {
  const raw =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    open_last_dashboard: raw.open_last_dashboard === true,
  };
}
