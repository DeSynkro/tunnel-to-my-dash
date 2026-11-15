import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { isTrustedIpcSender } from "../src/main/ipc-trust.ts";

const preload = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "test-ipc-preload.cjs",
);

async function main() {
  app.on("window-all-closed", () => {});
  await app.whenReady();

  const trusted = new Set();
  ipcMain.handle("test:ipc-trust", (event) => {
    return isTrustedIpcSender(event, trusted) ? "ok" : "denied";
  });

  const invoke = async (isTrusted) => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload,
        contextIsolation: true,
        sandbox: true,
      },
    });
    if (isTrusted) {
      trusted.add(window.webContents.id);
    }
    await window.loadURL("data:text/html,<p>ipc trust test</p>");
    const result = await window.webContents.executeJavaScript(
      "window.testIpc.call()",
    );
    window.destroy();
    return result;
  };

  try {
    assert.equal(await invoke(true), "ok");
    assert.equal(await invoke(false), "denied");
    console.log("ipc trust: trusted top-level sender accepted");
    console.log("ipc trust: unknown webContents rejected");
    console.log("ipc trust: PASS");
  } finally {
    // Nothing to close: each window is destroyed above.
  }

  app.exit(0);
}

main().catch((error) => {
  console.error(`ipc trust: FAIL ${error?.stack || error}`);
  app.exit(1);
});
