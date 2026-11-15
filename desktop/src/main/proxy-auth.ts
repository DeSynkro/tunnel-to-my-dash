export interface ProxyAuth {
  host: string;
  port: number;
  token: string;
}

export interface ProxyAuthInfo {
  isProxy: boolean;
  host: string;
  port: number;
  scheme?: string;
}

/**
 * Parses the core's proxy address and pairs it with the per-run token.
 * Returns null when authentication is not enabled.
 */
export function proxyAuthFromAddress(
  proxy: string,
  token: string,
): ProxyAuth | null {
  if (!proxy || !token) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${proxy}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const port = Number(parsed.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return { host, port, token };
}

/**
 * Supplies credentials only when Chromium asks for the app's own proxy.
 * Other proxy challenges and normal site logins stay unhandled.
 */
export function proxyCredentialsFor(
  authInfo: ProxyAuthInfo,
  auth: ProxyAuth | null,
): { username: string; password: string } | null {
  if (!authInfo.isProxy || !auth) {
    return null;
  }
  if (authInfo.scheme && authInfo.scheme !== "basic") {
    return null;
  }
  if (authInfo.host !== auth.host || authInfo.port !== auth.port) {
    return null;
  }
  return { username: "ttmd", password: auth.token };
}
