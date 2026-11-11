import { randomBytes } from "node:crypto";
import {
  app,
  BaseWindow,
  BrowserWindow,
  Menu,
  session,
  WebContentsView,
  type WebPreferences,
} from "electron";
import path from "node:path";
import { IPC } from "../shared/ipc";
import type { ConnectResult } from "../shared/types";
import { ControlClient } from "./control-client";
import { CoreProcess } from "./core-process";
import { resolveDataRoot } from "./data-dir";
import { registerIpc, type NavigationActions } from "./ipc";
import { isPrivateHttpUrl } from "./private-url";

app.setName("Tunnel to My Dash");

const defaultUserData = path.join(app.getPath("appData"), app.getName());
let dataRoot: string;
try {
  dataRoot = resolveDataRoot({
    appPath: app.getAppPath(),
    defaultUserData,
    isPackaged: app.isPackaged,
    env: process.env,
  });
} catch (error) {
  console.error(`[data] ${errorMessage(error)}`);
  dataRoot = defaultUserData;
}

const coreDataDir = path.join(dataRoot, "core");
const socketPath = path.join(coreDataDir, "control.sock");
app.setPath("userData", path.join(dataRoot, "electron"));

app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("disable-sync");
app.commandLine.appendSwitch("disable-quic");
app.commandLine.appendSwitch("disable-client-side-phishing-detection");
app.commandLine.appendSwitch("disable-spell-checking");
app.commandLine.appendSwitch("disable-component-extensions-with-background-pages");
app.commandLine.appendSwitch("no-pings");
app.commandLine.appendSwitch("disable-breakpad");
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
app.commandLine.appendSwitch("host-resolver-rules", "MAP * ~NOTFOUND, EXCLUDE 127.0.0.1");
app.commandLine.appendSwitch(
  "disable-features",
  "SafeBrowsing,OptimizationHints,MediaRouter,Translate,AutofillServerCommunication,InterestFeedContentSuggestions,DnsOverHttps,NetworkTimeServiceQuerying,OptimizationGuideModelDownloading,OptimizationHintsFetching",
);

if (process.env.TTMD_NETLOG) {
  app.commandLine.appendSwitch("log-net-log", process.env.TTMD_NETLOG);
  app.commandLine.appendSwitch("net-log-capture-mode", "IncludeSensitive");
}

let control: ControlClient | null = null;
let coreError: string | null = null;
let core: CoreProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let dashboardWindow: BaseWindow | null = null;
let dashboardView: WebContentsView | null = null;
let dashboardToolbar: WebContentsView | null = null;
let dashboardHomeURL = "";

const toolbarHeight = 36;

function resolveCorePath(): string {
  if (process.env.TTMD_CORE) {
    return process.env.TTMD_CORE;
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "ttmd-core");
  }
  return path.resolve(app.getAppPath(), "..", "build", "ttmd-core");
}

async function startCore(): Promise<void> {
  core = new CoreProcess({
    binPath: resolveCorePath(),
    dataDir: coreDataDir,
    socketPath,
    onExit: (message) => {
      coreError = message;
      console.error(`[core] ${message}`);
    },
  });

  try {
    await core.start();
    control = new ControlClient(socketPath);
  } catch (error) {
    coreError = errorMessage(error);
    control = null;
    console.error(`[core] ${coreError}`);
  }
}

function dashboardWebPreferences(partition: string): WebPreferences {
  return {
    partition,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
    webviewTag: false,
    devTools: !app.isPackaged,
  };
}

function sendNavState(): void {
  if (!dashboardView || !dashboardToolbar) {
    return;
  }
  const history = dashboardView.webContents.navigationHistory;
  dashboardToolbar.webContents.send(IPC.navState, {
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
    url: dashboardView.webContents.getURL(),
  });
}

const navigation: NavigationActions = {
  back: () => {
    dashboardView?.webContents.navigationHistory.goBack();
  },
  forward: () => {
    dashboardView?.webContents.navigationHistory.goForward();
  },
  reload: () => {
    dashboardView?.webContents.reload();
  },
  home: () => {
    if (dashboardView) {
      void dashboardView.webContents.loadURL(dashboardHomeURL);
    }
  },
  backToApp: () => {
    dashboardWindow?.close();
  },
};

async function openDashboard(profileID: string, result: ConnectResult): Promise<void> {
  if (dashboardWindow) {
    dashboardWindow.focus();
    return;
  }

  console.log(`[dashboard] proxy=${result.proxy}`);

  const partition = `persist:profile-${profileID}`;
  const dashboardSession = session.fromPartition(partition);
  await dashboardSession.setProxy({
    proxyRules: `http=${result.proxy};https=${result.proxy}`,
  });
  dashboardSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  dashboardSession.setPermissionCheckHandler(() => false);
  dashboardSession.setSpellCheckerEnabled(false);

  const window = new BaseWindow({
    width: 1100,
    height: 780,
    minWidth: 800,
    minHeight: 600,
    title: "Tunnel to My Dash",
    backgroundColor: "#0e1012",
  });

  const view = new WebContentsView({
    webPreferences: dashboardWebPreferences(partition),
  });
  const toolbar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "toolbar-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  window.contentView.addChildView(view);
  window.contentView.addChildView(toolbar);

  const layout = (): void => {
    const { width, height } = window.getContentBounds();
    toolbar.setBounds({ x: 0, y: 0, width, height: toolbarHeight });
    view.setBounds({
      x: 0,
      y: toolbarHeight,
      width,
      height: Math.max(0, height - toolbarHeight),
    });
  };
  window.on("resize", layout);
  layout();

  dashboardWindow = window;
  dashboardView = view;
  dashboardToolbar = toolbar;
  dashboardHomeURL = result.dashboard_url;

  void toolbar.webContents.loadFile(path.join(__dirname, "renderer/toolbar.html"));
  toolbar.webContents.on("did-finish-load", sendNavState);

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isPrivateHttpUrl(url)) {
      void view.webContents.loadURL(url);
    }
    return { action: "deny" };
  });
  view.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      event.preventDefault();
    }
  });
  view.webContents.on("did-navigate", sendNavState);
  view.webContents.on("did-navigate-in-page", sendNavState);
  view.webContents.on("page-title-updated", (_event, title) => {
    window.setTitle(title ? `${title} — Tunnel to My Dash` : "Tunnel to My Dash");
  });

  window.on("closed", () => {
    dashboardWindow = null;
    dashboardView = null;
    dashboardToolbar = null;
    dashboardHomeURL = "";
    if (control) {
      void control.disconnect().catch(() => undefined);
    }
    if (mainWindow) {
      mainWindow.show();
      mainWindow.webContents.send(IPC.statusChanged);
    }
  });

  mainWindow?.hide();

  try {
    await view.webContents.loadURL(result.dashboard_url);
  } catch (error) {
    console.error(`[dashboard] ${errorMessage(error)}`);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 720,
    minHeight: 520,
    show: false,
    center: true,
    title: "Tunnel to My Dash",
    backgroundColor: "#0e1012",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" as const }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`[renderer] failed to load (${code}): ${description}`);
  });

  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));

  if (
    process.env.TTMD_SMOKE === "1" ||
    process.env.TTMD_SMOKE === "full" ||
    process.env.TTMD_SMOKE === "idle"
  ) {
    mainWindow.webContents.once("did-finish-load", () => {
      if (mainWindow) {
        void runSmoke(mainWindow);
      }
    });
  }
}

async function runSmoke(window: BrowserWindow): Promise<void> {
  const full = process.env.TTMD_SMOKE === "full";
  const idle = process.env.TTMD_SMOKE === "idle";
  const deadline = Date.now() + (full ? 45_000 : 12_000);
  let submitted = false;
  let dashboardTried = false;
  let dashboardClosed = false;

  while (Date.now() < deadline) {
    try {
      const state = (await window.webContents.executeJavaScript(`({
        screen: document.body.dataset.screen || "",
        profiles: document.querySelectorAll(".profile").length,
        error: document.getElementById("setup-error")?.textContent || "",
      })`)) as { screen: string; profiles: number; error: string };

      if (idle && state.screen && state.screen !== "loading") {
        await delay(2000);
        console.log(`[smoke] idle screen=${state.screen}`);
        app.quit();
        return;
      }

      if (!submitted && state.screen === "setup") {
        await submitSmokeSetup(window);
        submitted = true;
        continue;
      }

      if (state.screen === "main") {
        if (!dashboardTried) {
          console.log(`[smoke] screen=main profiles=${state.profiles}`);
          if (state.profiles < 1) {
            process.exitCode = 1;
            app.quit();
            return;
          }

          await window.webContents.executeJavaScript(
            'document.querySelector(".profile-actions button")?.click()',
          );
          dashboardTried = true;

          if (!(await waitForDashboard(5000))) {
            console.error("[smoke] dashboard window did not open");
            process.exitCode = 1;
            app.quit();
            return;
          }

          console.log("[smoke] dashboard opened");

          if (full) {
            if (!(await waitForDashboardLoad(30_000))) {
              console.error("[smoke] dashboard did not finish loading");
              process.exitCode = 1;
              app.quit();
              return;
            }
            const state = dashboardView
              ? ((await dashboardView.webContents.executeJavaScript(`({
                  title: document.title,
                  bodyLength: (document.body?.innerText || "").length,
                  errorPage:
                    (document.body?.innerText || "").includes("ERR_PROXY") ||
                    (document.body?.innerText || "").includes("This site can"),
                })`)) as { title: string; bodyLength: number; errorPage: boolean })
              : { title: "", bodyLength: 0, errorPage: true };

            console.log(
              `[smoke] dashboard loaded title=${JSON.stringify(state.title)} body=${state.bodyLength} errorPage=${state.errorPage}`,
            );
            if (state.errorPage) {
              process.exitCode = 1;
            }
          }

          if (full && dashboardView) {
            const before = dashboardView.webContents.getURL();
            const clicked = (await dashboardView.webContents.executeJavaScript(
              `(() => {
                const link = document.querySelector('a[target="_blank"][href^="http://192.168."]');
                if (!link) return false;
                link.click();
                return true;
              })()`,
              true,
            )) as boolean;

            console.log(`[smoke] service link clicked=${clicked}`);
            if (clicked) {
              const navigated = await waitForDashboardURL(
                (url) => url !== before && url.startsWith("http://192.168."),
                5000,
              );
              console.log(
                `[smoke] service link navigated=${navigated} url=${dashboardView.webContents.getURL()}`,
              );
              if (!navigated) {
                process.exitCode = 1;
              } else if (dashboardToolbar) {
                await dashboardToolbar.webContents.executeJavaScript(
                  "window.ttmdNav.back()",
                  true,
                );
                const back = await waitForDashboardURL((url) => url === before, 5000);
                console.log(`[smoke] toolbar back=${back}`);
                if (!back) {
                  process.exitCode = 1;
                }
              }
            }
          }

          if (full && dashboardToolbar) {
            await dashboardToolbar.webContents.executeJavaScript(
              'document.getElementById("app")?.click()',
              true,
            );
            const closed = await waitForDashboardClosed(3000);
            console.log(`[smoke] back-to-app=${closed}`);
            if (!closed) {
              process.exitCode = 1;
            }
          } else {
            dashboardWindow?.close();
          }
          dashboardClosed = true;
          await delay(200);
          continue;
        }

        if (dashboardClosed) {
          console.log(`[smoke] screen=main after dashboard profiles=${state.profiles}`);
          app.quit();
          return;
        }
      }

      if (submitted && state.error) {
        console.error(`[smoke] setup error: ${state.error}`);
        process.exitCode = 1;
        app.quit();
        return;
      }

      if (state.screen === "error" || state.screen === "lock") {
        console.error(`[smoke] unexpected screen=${state.screen}`);
        process.exitCode = 1;
        app.quit();
        return;
      }
    } catch (error) {
      console.error(`[smoke] ${errorMessage(error)}`);
    }
    await delay(100);
  }

  console.error("[smoke] the UI did not settle in time");
  process.exitCode = 1;
  app.quit();
}

async function waitForDashboardLoad(timeoutMs: number): Promise<boolean> {
  const view = dashboardView;
  if (!view) {
    return false;
  }
  if (!view.webContents.isLoading()) {
    return true;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    view.webContents.once("did-finish-load", () => finish(true));
    view.webContents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) {
        finish(false);
      }
    });
  });
}

async function waitForDashboardURL(
  predicate: (url: string) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(dashboardView?.webContents.getURL() ?? "")) {
      return true;
    }
    await delay(50);
  }
  return false;
}

async function waitForDashboardClosed(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!dashboardWindow) {
      return true;
    }
    await delay(50);
  }
  return false;
}

async function waitForDashboard(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dashboardWindow) {
      return true;
    }
    await delay(50);
  }
  return false;
}

async function submitSmokeSetup(window: BrowserWindow): Promise<void> {
  const config = smokeTunnelConfig();
  await window.webContents.executeJavaScript(`(() => {
    const set = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.value = value;
    };
    set("setup-name", "Home");
    set("setup-config", ${JSON.stringify(config)});
    set("setup-url", "http://192.168.0.3:3000");
    const lock = document.getElementById("setup-lock");
    if (lock) {
      lock.checked = false;
      lock.dispatchEvent(new Event("change"));
    }
    document.getElementById("setup-form")?.requestSubmit();
  })()`);
}

function smokeTunnelConfig(): string {
  const key = () => randomBytes(32).toString("base64");
  return `[Interface]
PrivateKey = ${key()}
Address = 10.66.0.2/24
MTU = 1420

[Peer]
PublicKey = ${key()}
PresharedKey = ${key()}
Endpoint = 127.0.0.1:51820
AllowedIPs = 0.0.0.0/0
`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setSpellCheckerEnabled(false);

  await startCore();
  registerIpc({
    control,
    coreError,
    getWindow: () => mainWindow,
    navigation,
    openDashboard,
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  core?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
