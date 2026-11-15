import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedIpcSender } from "./ipc-trust.ts";

const mainFrame = {};

test("accepts a trusted top-level sender", () => {
  assert.equal(
    isTrustedIpcSender(
      {
        sender: { id: 7, mainFrame },
        senderFrame: mainFrame,
      },
      new Set([7]),
    ),
    true,
  );
});

test("rejects unknown senders", () => {
  assert.equal(
    isTrustedIpcSender(
      {
        sender: { id: 8, mainFrame },
        senderFrame: mainFrame,
      },
      new Set([7]),
    ),
    false,
  );
});

test("rejects subframes and destroyed frames", () => {
  assert.equal(
    isTrustedIpcSender(
      {
        sender: { id: 7, mainFrame },
        senderFrame: {},
      },
      new Set([7]),
    ),
    false,
  );
  assert.equal(
    isTrustedIpcSender(
      {
        sender: { id: 7, mainFrame },
        senderFrame: null,
      },
      new Set([7]),
    ),
    false,
  );
});
