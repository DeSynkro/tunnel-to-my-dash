import assert from "node:assert/strict";
import http from "node:http";
import { app, BrowserWindow, session } from "electron";
import { dashboardProxyConfig } from "../src/main/dashboard-proxy.ts";
import {
  proxyAuthFromAddress,
  proxyCredentialsFor,
} from "../src/main/proxy-auth.ts";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  app.on("window-all-closed", () => {});
  await app.whenReady();

  let authorized = 0;
  let unauthorized = 0;
  let targetHits = 0;
  const expected = `Basic ${Buffer.from("ttmd:secret").toString("base64")}`;

  const target = http.createServer((_req, res) => {
    targetHits += 1;
    res.writeHead(200, { "content-type": "text/html", "content-length": "6" });
    res.end("target");
  });
  const targetPort = await listen(target);

  const proxy = http.createServer((req, res) => {
    if (req.headers["proxy-authorization"] !== expected) {
      unauthorized += 1;
      res.writeHead(407, {
        "proxy-authenticate": 'Basic realm="Tunnel to My Dash"',
        "content-length": "0",
      });
      res.end();
      return;
    }
    authorized += 1;
    const body = "authorized";
    res.writeHead(200, {
      "content-type": "text/html",
      "content-length": String(Buffer.byteLength(body)),
      "cache-control": "no-store",
    });
    res.end(body);
  });
  const proxyPort = await listen(proxy);
  const proxyAddress = `127.0.0.1:${proxyPort}`;
  let auth = proxyAuthFromAddress(proxyAddress, "secret");
  assert.ok(auth);

  app.on("login", (event, _webContents, _details, authInfo, callback) => {
    const credentials = proxyCredentialsFor(authInfo, auth);
    if (!credentials) {
      return;
    }
    event.preventDefault();
    callback(credentials.username, credentials.password);
  });

  const load = async (partition) => {
    const targetSession = session.fromPartition(partition);
    await targetSession.setProxy(dashboardProxyConfig(proxyAddress));

    // A fresh in-memory session can resolve before its proxy rules are live.
    let resolved = "";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      resolved = await targetSession.resolveProxy("http://127.0.0.1/");
      if (resolved.startsWith("PROXY ")) {
        break;
      }
      await delay(20);
    }
    assert.match(resolved, /^PROXY /);

    const window = new BrowserWindow({
      show: false,
      webPreferences: { partition, sandbox: true },
    });
    try {
      await window.webContents.loadURL(
        `http://127.0.0.1:${targetPort}/page`,
      );
    } catch {
      // A failed proxy login cancels the navigation.
    }
    await delay(300);
    const text = await window.webContents
      .executeJavaScript("document.body?.innerText || ''")
      .catch(() => "");
    window.destroy();
    return text;
  };

  try {
    const authenticated = await load(`proxy-auth-ok-${process.pid}`);
    assert.equal(authenticated, "authorized");
    assert.equal(authorized, 1);
    assert.equal(unauthorized, 1, "the proxy should issue one challenge");
    assert.equal(targetHits, 0, "the proxy should answer, not the target");

    auth = null;
    const denied = await load(`proxy-auth-missing-${process.pid}`);
    assert.notEqual(denied, "authorized");
    assert.equal(authorized, 1);
    assert.equal(unauthorized, 2);
    assert.equal(targetHits, 0, "the proxy should answer, not the target");

    console.log("proxy auth: Electron answers the app proxy challenge");
    console.log("proxy auth: missing credentials fail closed");
    console.log("proxy auth: PASS");
  } finally {
    await close(proxy);
    await close(target);
  }

  app.exit(0);
}

main().catch((error) => {
  console.error(`proxy auth: FAIL ${error?.stack || error}`);
  app.exit(1);
});
