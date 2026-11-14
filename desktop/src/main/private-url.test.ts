import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateHttpUrl, isPublicHttpUrl } from "./private-url.ts";

test("recognizes LAN URLs as private", () => {
  assert.equal(isPrivateHttpUrl("http://192.168.1.10:3000/"), true);
  assert.equal(isPrivateHttpUrl("https://10.0.0.5/"), true);
  assert.equal(isPrivateHttpUrl("http://172.20.1.1/"), true);
  assert.equal(isPrivateHttpUrl("http://[fd00::1]/"), true);
  assert.equal(isPrivateHttpUrl("http://example.com/"), false);
  assert.equal(isPrivateHttpUrl("file:///etc/passwd"), false);
});

test("opens only public HTTP and HTTPS links", () => {
  assert.equal(isPublicHttpUrl("https://example.com/"), true);
  assert.equal(isPublicHttpUrl("http://example.com:8080/path"), true);
  assert.equal(isPublicHttpUrl("https://8.8.8.8/"), true);
  assert.equal(isPublicHttpUrl("https://[2001:4860:4860::8888]/"), true);
});

test("rejects local, private and unsafe link targets", () => {
  for (const value of [
    "http://localhost/",
    "http://printer/",
    "http://printer.local/",
    "http://router.lan/",
    "http://device.home.arpa/",
    "http://192.168.1.1/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://127.0.0.1/",
    "http://169.254.1.1/",
    "http://0.0.0.0/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
    "not a url",
  ]) {
    assert.equal(isPublicHttpUrl(value), false, value);
  }
});
