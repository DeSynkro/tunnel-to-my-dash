import type { CredentialSummary } from "../shared/types";

export function normalizedOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

export function credentialName(title: string, url: string): string {
  let name = title.replace(/\s+/g, " ").trim();
  name = name
    .replace(/\s*[-|·•]\s*(login|log in|sign in)\s*$/i, "")
    .replace(/^(login|log in|sign in)\s*[-|·•]\s*/i, "")
    .trim();
  if (!name || /^(login|log in|sign in)$/i.test(name)) {
    try {
      name = new URL(url).host;
    } catch {
      name = url;
    }
  }
  return name.slice(0, 64);
}

export function credentialsForOrigin(
  credentials: CredentialSummary[],
  origin: string,
): CredentialSummary[] {
  return credentials.filter(
    (credential) => normalizedOrigin(credential.url ?? "") === origin,
  );
}

export function matchingCredentials(
  credentials: CredentialSummary[],
  origin: string,
  username: string,
): CredentialSummary[] {
  return credentialsForOrigin(credentials, origin).filter(
    (credential) => (credential.username ?? "") === username,
  );
}

export function pickCredentialMatch(
  matches: CredentialSummary[],
  title: string,
  origin: string,
): CredentialSummary | null {
  if (matches.length === 0) {
    return null;
  }
  if (matches.length === 1) {
    return matches[0];
  }
  const name = credentialName(title, origin).toLowerCase();
  return matches.find((match) => match.name.toLowerCase() === name) ?? null;
}
