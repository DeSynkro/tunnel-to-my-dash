import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface BrowserStateSession {
  closeAllConnections(): Promise<void>;
  clearData(): Promise<void>;
  clearAuthCache(): Promise<void>;
  clearHostResolverCache(): Promise<void>;
}

/**
 * Builds the in-memory partition name for a dashboard profile.
 *
 * Hashing keeps arbitrary profile IDs out of Chromium's partition paths. The
 * name deliberately has no `persist:` prefix so cookies, localStorage and
 * cache do not survive the process.
 */
export function dashboardPartitionName(profileID: string): string {
  const digest = createHash("sha256").update(profileID).digest("hex");
  return `profile-${digest.slice(0, 32)}`;
}

/**
 * Clears everything a dashboard page may have retained in its session.
 *
 * Connections close first so the page cannot keep writing while storage and
 * the HTTP/auth caches are cleared.
 */
export async function clearDashboardBrowserState(
  target: BrowserStateSession,
): Promise<void> {
  await target.closeAllConnections();
  await target.clearData();
  await target.clearAuthCache();
  await target.clearHostResolverCache();
}

/**
 * Removes legacy persistent dashboard partitions from older builds.
 *
 * Older releases used `persist:profile-<id>`, which Chromium stores under the
 * `Partitions` directory. They are no longer used, so startup removes them
 * before any session can open them.
 */
export async function removeLegacyDashboardPartitions(
  partitionsDir: string,
): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(partitionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.name.startsWith("profile-")) {
      continue;
    }
    await fs.rm(path.join(partitionsDir, entry.name), {
      recursive: true,
      force: true,
    });
    removed.push(entry.name);
  }
  return removed;
}
