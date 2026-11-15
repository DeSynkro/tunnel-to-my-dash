export interface DashboardProxyConfig {
  proxyRules: string;
  proxyBypassRules: string;
}

/**
 * Chromium normally sends loopback and link-local requests directly, bypassing
 * the proxy. The dashboard must never do that: it would let page content reach
 * local services without the core proxy policy seeing it. `<-loopback>`
 * removes that implicit bypass.
 */
export function dashboardProxyConfig(proxy: string): DashboardProxyConfig {
  return {
    proxyRules: `http=${proxy};https=${proxy}`,
    proxyBypassRules: "<-loopback>",
  };
}
