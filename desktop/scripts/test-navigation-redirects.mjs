import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import { app, BrowserWindow, session } from "electron";
import { guardDashboardNavigation } from "../src/main/navigation-policy.ts";
import { isPrivateHttpUrl } from "../src/main/private-url.ts";

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function html(body) {
  return `<!doctype html><title>${body}</title><p>${body}</p>`;
}

function sendHTML(res, body) {
  const payload = html(body);
  res.writeHead(200, {
    "content-type": "text/html",
    "content-length": String(Buffer.byteLength(payload)),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function redirect(res, location) {
  res.writeHead(302, { location, "cache-control": "no-store" });
  res.end();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function privateIPv4() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (
        (entry.family === "IPv4" || entry.family === 4) &&
        !entry.internal &&
        isPrivateHttpUrl(`http://${entry.address}/`)
      ) {
        return entry.address;
      }
    }
  }
  return null;
}

async function main() {
  const privateHost = privateIPv4();
  if (!privateHost) {
    console.log("navigation: no private IPv4 address, integration check skipped");
    app.exit(0);
    return;
  }

  app.commandLine.appendSwitch(
    "host-resolver-rules",
    "MAP public.test 127.0.0.1",
  );
  await app.whenReady();

  let publicHits = 0;
  let loopbackHits = 0;

  const publicServer = http.createServer((req, res) => {
    publicHits += 1;
    sendHTML(res, `public:${req.url}`);
  });
  const publicPort = await listen(publicServer, "127.0.0.1");

  const loopbackServer = http.createServer((req, res) => {
    loopbackHits += 1;
    sendHTML(res, `loopback:${req.url}`);
  });
  const loopbackPort = await listen(loopbackServer, "127.0.0.1");

  let privatePort = 0;
  const privateServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${privateHost}:${privatePort}`);
    switch (url.pathname) {
      case "/private":
        sendHTML(res, "private");
        return;
      case "/private2":
        sendHTML(res, "private2");
        return;
      case "/redirect-public":
        redirect(res, `http://public.test:${publicPort}/public`);
        return;
      case "/redirect-loopback":
        redirect(res, `http://127.0.0.1:${loopbackPort}/secret`);
        return;
      case "/redirect-private":
        redirect(res, `http://${privateHost}:${privatePort}/private2`);
        return;
      case "/meta-public":
        sendHTML(
          res,
          `<meta http-equiv="refresh" content="0;url=http://public.test:${publicPort}/public">`,
        );
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  privatePort = await listen(privateServer, privateHost);

  const base = `http://${privateHost}:${privatePort}`;

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: `navigation-${process.pid}`,
      sandbox: true,
      contextIsolation: true,
    },
  });
  const contents = window.webContents;
  const external = [];
  guardDashboardNavigation(contents, () => false, (url) => external.push(url));

  try {
    await contents.loadURL(`${base}/private`);
    assert.equal(contents.getURL(), `${base}/private`);

    publicHits = 0;
    await contents
      .executeJavaScript("window.location.href = '/redirect-public'")
      .catch(() => {});
    await sleep(500);
    assert.equal(publicHits, 0, "a 302 to a public URL must not load");
    assert.equal(contents.getURL(), `${base}/private`);

    loopbackHits = 0;
    await contents
      .executeJavaScript("window.location.href = '/redirect-loopback'")
      .catch(() => {});
    await sleep(500);
    assert.equal(loopbackHits, 0, "a 302 to loopback must not load");
    assert.equal(contents.getURL(), `${base}/private`);

    publicHits = 0;
    await contents.loadURL(`${base}/meta-public`).catch(() => {});
    await sleep(1000);
    assert.equal(publicHits, 0, "meta refresh to a public URL must not load");
    assert.equal(contents.getURL(), `${base}/meta-public`);

    await contents.loadURL(`${base}/redirect-private`);
    assert.equal(contents.getURL(), `${base}/private2`);

    await contents.executeJavaScript("window.location.href = '/private'");
    await sleep(500);
    assert.equal(contents.getURL(), `${base}/private`);

    const externalWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: `navigation-external-${process.pid}`,
        sandbox: true,
        contextIsolation: true,
      },
    });
    const externalContents = externalWindow.webContents;
    const opened = [];
    guardDashboardNavigation(
      externalContents,
      () => true,
      (url) => opened.push(url),
    );
    publicHits = 0;
    await externalContents
      .loadURL(`${base}/redirect-public`)
      .catch(() => {});
    await sleep(500);
    assert.equal(publicHits, 0, "allowed public redirects open externally");
    assert.deepEqual(opened, [`http://public.test:${publicPort}/public`]);
    externalWindow.destroy();

    console.log("navigation: redirects and meta refresh stay inside policy");
    console.log("navigation: PASS");
  } finally {
    window.destroy();
    await close(privateServer);
    await close(publicServer);
    await close(loopbackServer);
  }

  app.exit(0);
}

main().catch((error) => {
  console.error(`navigation: FAIL ${error?.stack || error}`);
  app.exit(1);
});
