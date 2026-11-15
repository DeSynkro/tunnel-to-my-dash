import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, session as electronSession } from "electron";
import {
  clearDashboardBrowserState,
  dashboardPartitionName,
} from "../src/main/browser-state.ts";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ttmd-browser-state-"));
app.setPath("userData", userData);

async function main() {
  await app.whenReady();

  const server = http.createServer((_req, res) => {
    const payload = `<!doctype html><script>
      document.cookie = "ttmd_state=1; path=/";
      localStorage.setItem("ttmd_state", "1");
      sessionStorage.setItem("ttmd_state", "1");
    </script>`;
    res.writeHead(200, {
      "content-type": "text/html",
      "content-length": String(Buffer.byteLength(payload)),
      "cache-control": "no-store",
    });
    res.end(payload);
  });
  const port = await listen(server);

  const partition = dashboardPartitionName("state-test");
  const target = electronSession.fromPartition(partition);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
    },
  });
  const contents = window.webContents;

  try {
    await contents.loadURL(`http://127.0.0.1:${port}/`);
    assert.equal(
      (await target.cookies.get({ name: "ttmd_state" })).length,
      1,
      "test cookie should be present before clearing",
    );
    assert.equal(
      await contents.executeJavaScript("localStorage.getItem('ttmd_state')"),
      "1",
    );
    assert.equal(
      await contents.executeJavaScript("sessionStorage.getItem('ttmd_state')"),
      "1",
    );

    assert.equal(
      fs.existsSync(path.join(userData, "Partitions", partition)),
      false,
      "an in-memory partition must not leave a disk profile",
    );

    await clearDashboardBrowserState(target);
    await clearDashboardBrowserState(target);

    assert.equal(
      (await target.cookies.get({ name: "ttmd_state" })).length,
      0,
      "cookies should be gone after clearing",
    );
    assert.equal(
      await contents.executeJavaScript("localStorage.getItem('ttmd_state')"),
      null,
      "localStorage should be gone after clearing",
    );
    assert.equal(
      await contents.executeJavaScript("sessionStorage.getItem('ttmd_state')"),
      null,
      "sessionStorage should be gone after clearing",
    );

    console.log("browser state: cookies and storage cleared in memory");
    console.log("browser state: PASS");
  } finally {
    window.destroy();
    await close(server);
  }

  app.exit(0);
}

main().catch((error) => {
  console.error(`browser state: FAIL ${error?.stack || error}`);
  app.exit(1);
});
