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
