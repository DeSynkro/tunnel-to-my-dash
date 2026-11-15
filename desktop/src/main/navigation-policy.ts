import type { WebContents } from "electron";
import { isPrivateHttpUrl, isPublicHttpUrl } from "./private-url.ts";

export type NavigationOutcome = "allow" | "external" | "block";

/**
 * Decides what to do with a main-frame navigation target.
 *
 * Private LAN pages stay in the dashboard. Public pages may be handed to the
 * system browser when the user allows external links. Everything else,
 * including loopback, link-local and non-HTTP schemes, is blocked.
 */
export function navigationOutcome(
  url: string,
  openExternalLinks: boolean,
): NavigationOutcome {
  if (isPrivateHttpUrl(url)) {
    return "allow";
  }
  if (isPublicHttpUrl(url) && openExternalLinks) {
    return "external";
  }
  return "block";
}

interface NavigationDetails {
  url: string;
  isMainFrame: boolean;
  preventDefault(): void;
}

/**
 * Applies the navigation policy to a webContents.
 *
 * `will-frame-navigate` covers page-initiated navigations, including
 * `window.location` changes and meta refresh. `will-redirect` covers HTTP 3xx
 * responses, which do not emit `will-navigate`.
 */
export function guardDashboardNavigation(
  contents: WebContents,
  openExternalLinks: () => boolean,
  openExternal: (url: string) => void,
): void {
  const handle = (details: NavigationDetails): void => {
    if (!details.isMainFrame) {
      return;
    }
    const outcome = navigationOutcome(details.url, openExternalLinks());
    if (outcome === "allow") {
      return;
    }
    details.preventDefault();
    if (outcome === "external") {
      openExternal(details.url);
    }
  };

  contents.on("will-frame-navigate", handle);
  contents.on("will-redirect", handle);
}
