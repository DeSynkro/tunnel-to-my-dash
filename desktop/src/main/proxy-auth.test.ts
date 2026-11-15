import assert from "node:assert/strict";
import test from "node:test";
import { proxyAuthFromAddress, proxyCredentialsFor } from "./proxy-auth.ts";

test("parses the core proxy address with a token", () => {
  assert.deepEqual(proxyAuthFromAddress("127.0.0.1:41000", "secret"), {
    host: "127.0.0.1",
    port: 41000,
    token: "secret",
  });
  assert.deepEqual(proxyAuthFromAddress("[::1]:41000", "secret"), {
    host: "::1",
    port: 41000,
    token: "secret",
  });
});

test("ignores missing credentials and invalid addresses", () => {
  assert.equal(proxyAuthFromAddress("127.0.0.1:41000", ""), null);
  assert.equal(proxyAuthFromAddress("", "secret"), null);
  assert.equal(proxyAuthFromAddress("127.0.0.1", "secret"), null);
  assert.equal(proxyAuthFromAddress("not a proxy", "secret"), null);
});

test("answers only the app proxy challenge", () => {
  const auth = proxyAuthFromAddress("127.0.0.1:41000", "secret");
  assert.deepEqual(
    proxyCredentialsFor(
      { isProxy: true, host: "127.0.0.1", port: 41000, scheme: "basic" },
      auth,
    ),
    { username: "ttmd", password: "secret" },
  );
  assert.equal(
    proxyCredentialsFor(
      { isProxy: false, host: "127.0.0.1", port: 41000 },
      auth,
    ),
    null,
  );
  assert.equal(
    proxyCredentialsFor(
      { isProxy: true, host: "127.0.0.1", port: 41000, scheme: "ntlm" },
      auth,
    ),
    null,
  );
  assert.equal(
    proxyCredentialsFor(
      { isProxy: true, host: "127.0.0.1", port: 41001 },
      auth,
    ),
    null,
  );
  assert.equal(
    proxyCredentialsFor(
      { isProxy: true, host: "10.0.0.1", port: 41000 },
      auth,
    ),
    null,
  );
});
