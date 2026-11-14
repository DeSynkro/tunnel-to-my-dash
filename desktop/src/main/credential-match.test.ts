import assert from "node:assert/strict";
import test from "node:test";
import type { CredentialSummary } from "../shared/types.ts";
import {
  credentialName,
  credentialsForOrigin,
  matchingCredentials,
  normalizedOrigin,
  pickCredentialMatch,
} from "./credential-match.ts";

function credential(
  id: string,
  name: string,
  url: string,
  username: string,
): CredentialSummary {
  return { id, name, url, username };
}

test("normalizes a saved URL to its origin", () => {
  assert.equal(
    normalizedOrigin("http://192.168.1.11:8080/admin?tab=1"),
    "http://192.168.1.11:8080",
  );
  assert.equal(
    normalizedOrigin("https://dash.example.com"),
    "https://dash.example.com",
  );
  assert.equal(normalizedOrigin("not a url"), "not a url");
});

test("names a login from the page title and falls back to the host", () => {
  assert.equal(
    credentialName("Sonarr - Login", "http://192.168.1.10:8989"),
    "Sonarr",
  );
  assert.equal(
    credentialName("Sign in", "http://192.168.1.10:7979"),
    "192.168.1.10:7979",
  );
});

test("matches saved URLs by origin, not by path or trailing slash", () => {
  const credentials = [
    credential("a", "Sonarr", "http://192.168.1.10:8989/sonarr", "admin"),
    credential("b", "Radarr", "http://192.168.1.10:7878/", "admin"),
    credential("c", "Other", "http://192.168.1.11:8080", "admin"),
  ];
  const matches = credentialsForOrigin(credentials, "http://192.168.1.10:8989");
  assert.deepEqual(
    matches.map((match) => match.id),
    ["a"],
  );
});

test("filters origin and username together", () => {
  const credentials = [
    credential("a", "Sonarr", "http://192.168.1.10:8989/sonarr", "admin"),
    credential("b", "Sonarr", "http://192.168.1.10:8989/sonarr", "alex"),
  ];
  const matches = matchingCredentials(
    credentials,
    "http://192.168.1.10:8989",
    "alex",
  );
  assert.deepEqual(
    matches.map((match) => match.id),
    ["b"],
  );
});

test("picks a single match, or the title match when several share an origin", () => {
  const sonarr = credential(
    "a",
    "Sonarr",
    "http://192.168.1.10:8989/sonarr",
    "admin",
  );
  const radarr = credential(
    "b",
    "Radarr",
    "http://192.168.1.10:8989/radarr",
    "admin",
  );
  assert.equal(
    pickCredentialMatch([sonarr], "Sonarr", "http://192.168.1.10:8989"),
    sonarr,
  );
  assert.equal(
    pickCredentialMatch([sonarr, radarr], "Sonarr", "http://192.168.1.10:8989"),
    sonarr,
  );
  assert.equal(
    pickCredentialMatch(
      [sonarr, radarr],
      "Dashboard",
      "http://192.168.1.10:8989",
    ),
    null,
  );
  assert.equal(pickCredentialMatch([], "Sonarr", "http://192.168.1.10:8989"), null);
});
