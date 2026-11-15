import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearDashboardBrowserState,
  dashboardPartitionName,
  removeLegacyDashboardPartitions,
} from "./browser-state.ts";

test("uses a stable in-memory partition name", () => {
  const name = dashboardPartitionName("profile-id");
  assert.match(name, /^profile-[0-9a-f]{32}$/);
  assert.equal(name.startsWith("persist:"), false);
  assert.equal(dashboardPartitionName("profile-id"), name);
  assert.notEqual(dashboardPartitionName("another-profile"), name);
  assert.equal(name.includes("/"), false);
});

test("closes connections before clearing browser data", async () => {
  const calls: string[] = [];
  const target = {
    closeAllConnections: async () => {
      calls.push("connections");
    },
    clearData: async () => {
      calls.push("data");
    },
    clearAuthCache: async () => {
      calls.push("auth");
    },
    clearHostResolverCache: async () => {
      calls.push("dns");
    },
  };

  await clearDashboardBrowserState(target);

  assert.deepEqual(calls, ["connections", "data", "auth", "dns"]);
});

test("removes legacy persisted dashboard partitions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ttmd-partitions-"));
  try {
    const partitions = path.join(root, "Partitions");
    await fs.mkdir(path.join(partitions, "profile-old"), { recursive: true });
    await fs.mkdir(path.join(partitions, "profile-older"), { recursive: true });
    await fs.mkdir(path.join(partitions, "unrelated"), { recursive: true });
    await fs.writeFile(path.join(partitions, "profile-file"), "stale");

    const removed = await removeLegacyDashboardPartitions(partitions);

    assert.deepEqual(removed.sort(), [
      "profile-file",
      "profile-old",
      "profile-older",
    ]);
    for (const name of removed) {
      await assert.rejects(fs.stat(path.join(partitions, name)), {
        code: "ENOENT",
      });
    }
    assert.equal(
      (await fs.stat(path.join(partitions, "unrelated"))).isDirectory(),
      true,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("ignores a missing partitions directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ttmd-partitions-"));
  try {
    assert.deepEqual(
      await removeLegacyDashboardPartitions(path.join(root, "missing")),
      [],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
