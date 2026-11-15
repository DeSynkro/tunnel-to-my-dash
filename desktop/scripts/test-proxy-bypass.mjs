import assert from "node:assert/strict";
import http from "node:http";
import { app, net, session } from "electron";
import { dashboardProxyConfig } from "../src/main/dashboard-proxy.ts";

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(targetSession, url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session: targetSession });
    req.on("response", (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      response.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

function page(name) {
  return {
    headers: {
      "content-type": "text/html",
      "content-length": String(Buffer.byteLength(name)),
    },
    body: name,
  };
}

async function main() {
  await app.whenReady();

  const targetPage = page("target");
  const proxyPage = page("proxy");

  let targetHits = 0;
  let proxyHits = 0;

  const target = http.createServer((_req, res) => {
    targetHits += 1;
    res.writeHead(200, targetPage.headers);
    res.end(targetPage.body);
  });
  const targetPort = await listen(target);

  const proxy = http.createServer((_req, res) => {
    proxyHits += 1;
    res.writeHead(200, proxyPage.headers);
    res.end(proxyPage.body);
  });
  const proxyPort = await listen(proxy);

  const proxyAddress = `127.0.0.1:${proxyPort}`;
  const targetURL = `http://127.0.0.1:${targetPort}/page`;

  let ipv6Target = null;

  try {
    const baseline = session.fromPartition(`proxy-bypass-baseline-${process.pid}`);
    await baseline.setProxy({
      proxyRules: `http=${proxyAddress};https=${proxyAddress}`,
    });

    for (const probe of [
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://169.254.169.254/",
      "http://[fe80::1]/",
    ]) {
      assert.equal(
        await baseline.resolveProxy(probe),
        "DIRECT",
        `baseline should bypass the proxy for ${probe}`,
      );
    }

    let response = await request(baseline, targetURL);
    assert.equal(response.status, 200);
    assert.equal(response.body, "target");
    assert.equal(targetHits, 1, "baseline should reach the local target directly");
    assert.equal(proxyHits, 0, "baseline should not use the proxy");
    console.log("proxy bypass: baseline reaches loopback directly");

    const guarded = session.fromPartition(`proxy-bypass-guarded-${process.pid}`);
    await guarded.setProxy(dashboardProxyConfig(proxyAddress));

    for (const probe of [
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://169.254.169.254/",
      "http://[fe80::1]/",
    ]) {
      assert.match(
        await guarded.resolveProxy(probe),
        /^PROXY /,
        `guarded should route ${probe} through the proxy`,
      );
    }

    targetHits = 0;
    proxyHits = 0;
    response = await request(guarded, targetURL);
    assert.equal(response.status, 200);
    assert.equal(response.body, "proxy");
    assert.equal(targetHits, 0, "guarded must not reach the local target directly");
    assert.equal(proxyHits, 1, "guarded should use the proxy");
    console.log("proxy bypass: guarded sends loopback and link-local to the proxy");

    let ipv6Port = 0;
    try {
      ipv6Target = http.createServer((_req, res) => {
        targetHits += 1;
        res.writeHead(200, targetPage.headers);
        res.end(targetPage.body);
      });
      ipv6Port = await listen(ipv6Target, "::1");
    } catch (error) {
      if (ipv6Target) {
        await close(ipv6Target);
        ipv6Target = null;
      }
      if (error && error.code !== "EADDRNOTAVAIL" && error.code !== "EAFNOSUPPORT") {
        throw error;
      }
    }

    if (ipv6Target) {
      targetHits = 0;
      proxyHits = 0;
      response = await request(guarded, `http://[::1]:${ipv6Port}/page`);
      assert.equal(response.status, 200);
      assert.equal(response.body, "proxy");
      assert.equal(targetHits, 0, "guarded must not reach the IPv6 local target");
      assert.equal(proxyHits, 1, "guarded should proxy the IPv6 local target");
      console.log("proxy bypass: guarded protects an IPv6 loopback listener");
    } else {
      console.log("proxy bypass: IPv6 loopback unavailable, listener check skipped");
    }

    console.log("proxy bypass: PASS");
  } finally {
    if (ipv6Target) {
      await close(ipv6Target);
    }
    await close(target);
    await close(proxy);
  }

  app.exit(0);
}

main().catch((error) => {
  console.error(`proxy bypass: FAIL ${error?.stack || error}`);
  app.exit(1);
});
