import assert from "node:assert/strict";
import test from "node:test";
import { navigationOutcome } from "./navigation-policy.ts";

test("keeps private LAN pages in the dashboard", () => {
  assert.equal(navigationOutcome("http://192.168.1.10:8080/", false), "allow");
  assert.equal(navigationOutcome("https://10.0.0.5/", true), "allow");
  assert.equal(navigationOutcome("http://[fd00::1]/", false), "allow");
});

test("hands public pages to the system browser only when allowed", () => {
  assert.equal(navigationOutcome("https://example.com/", false), "block");
  assert.equal(navigationOutcome("https://example.com/", true), "external");
  assert.equal(navigationOutcome("http://8.8.8.8/", true), "external");
});

test("blocks loopback, link-local and unsafe targets", () => {
  for (const value of [
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.1.1/",
    "http://[fe80::1]/",
    "http://localhost/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
  ]) {
    assert.equal(navigationOutcome(value, true), "block", value);
  }
});
