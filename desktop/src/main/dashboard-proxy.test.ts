import assert from "node:assert/strict";
import test from "node:test";
import { dashboardProxyConfig } from "./dashboard-proxy.ts";

test("routes both HTTP and HTTPS through the app proxy", () => {
  const config = dashboardProxyConfig("127.0.0.1:41000");
  assert.equal(
    config.proxyRules,
    "http=127.0.0.1:41000;https=127.0.0.1:41000",
  );
});

test("disables Chromium's implicit loopback bypass", () => {
  const config = dashboardProxyConfig("127.0.0.1:41000");
  assert.equal(config.proxyBypassRules, "<-loopback>");
});

test("works for the smoke-test proxy form", () => {
  const config = dashboardProxyConfig("127.0.0.1:54321");
  assert.match(config.proxyRules, /http=127\.0\.0\.1:54321/);
  assert.equal(config.proxyBypassRules, "<-loopback>");
});
