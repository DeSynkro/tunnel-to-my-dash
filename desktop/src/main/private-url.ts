import net from "node:net";

export function isPrivateHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (net.isIPv4(host)) {
    const [first, second] = host.split(".").map(Number);
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (net.isIPv6(host)) {
    const lower = host.toLowerCase();
    return lower.startsWith("fc") || lower.startsWith("fd");
  }

  return false;
}

function publicIPv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = parts;
  if (first === 0 || first === 10 || first === 127 || first >= 224) {
    return false;
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return false;
  }
  if (first === 169 && second === 254) {
    return false;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return false;
  }
  if (first === 192 && second === 168) {
    return false;
  }
  return true;
}

export function isPublicHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) {
    return false;
  }

  if (net.isIPv4(host)) {
    return publicIPv4(host);
  }

  if (net.isIPv6(host)) {
    const lower = host.toLowerCase();
    if (lower === "::" || lower === "::1") {
      return false;
    }
    if (lower.startsWith("fc") || lower.startsWith("fd")) {
      return false;
    }
    if (/^fe[89ab]/.test(lower) || lower.startsWith("ff")) {
      return false;
    }
    if (lower.startsWith("::ffff:")) {
      return publicIPv4(lower.slice("::ffff:".length));
    }
    return true;
  }

  const lower = host.toLowerCase();
  if (lower === "localhost" || !lower.includes(".")) {
    return false;
  }
  if (/(^|\.)(local|internal|lan|home\.arpa)$/.test(lower)) {
    return false;
  }
  return true;
}
