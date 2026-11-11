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
    process.env.TTMD_SMOKE === "idle" ||
    process.env.TTMD_SMOKE === "settings" ||
    process.env.TTMD_SMOKE === "setup"
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
  const settings = process.env.TTMD_SMOKE === "settings";
  const setupSmoke = process.env.TTMD_SMOKE === "setup";
  const deadline = Date.now() + (full || settings || setupSmoke ? 60_000 : 12_000);
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

      if (settings) {
        if (state.screen === "main") {
          await runSettingsSmoke(window);
          return;
        }
        if (state.screen === "error" || state.screen === "lock" || state.screen === "setup") {
          console.error(`[smoke] settings needs a seeded, unlocked vault, got screen=${state.screen}`);
          process.exitCode = 1;
          app.quit();
          return;
        }
        await delay(100);
        continue;
      }

      if (setupSmoke) {
        if (state.screen === "setup") {
          await runSetupSmoke(window);
          return;
        }
        if (state.screen === "error" || state.screen === "lock" || state.screen === "main") {
          console.error(`[smoke] setup needs an empty data directory, got screen=${state.screen}`);
          process.exitCode = 1;
          app.quit();
          return;
        }
        await delay(100);
        continue;
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

async function runSetupSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] setup start");
    const config = smokeTunnelConfig();

    await window.webContents.executeJavaScript(
      `(() => {
        const set = (id, value) => {
          const node = document.getElementById(id);
          if (node) node.value = value;
        };
        set("setup-name", "Home");
        set("setup-config", ${JSON.stringify(config)});
        set("setup-url", "http://192.168.0.3:3000");
        const lock = document.getElementById("setup-lock");
        if (lock) {
          lock.checked = true;
          lock.dispatchEvent(new Event("change"));
        }
        set("setup-password", "setup-pass");
        set("setup-password-confirm", "setup-pasx");
        document.getElementById("setup-form")?.requestSubmit();
      })()`,
      true,
    );

    if (!(await waitForText(window, "setup-error", "Passwords do not match.", 3000))) {
      throw new Error("mismatched setup passwords were not rejected");
    }
    console.log("[smoke] setup confirm mismatch rejected");

    await window.webContents.executeJavaScript(
      `(() => {
        const lock = document.getElementById("setup-lock");
        if (lock) {
          lock.checked = false;
          lock.dispatchEvent(new Event("change"));
        }
        document.getElementById("setup-form")?.requestSubmit();
      })()`,
      true,
    );

    if (!(await waitForScreen(window, "main", 10_000))) {
      throw new Error("the first-run setup did not complete");
    }
    const profiles = (await window.webContents.executeJavaScript(
      'document.querySelectorAll(".profile").length',
    )) as number;
    console.log(`[smoke] setup complete profiles=${profiles}`);
    if (profiles < 1) {
      throw new Error("the first-run setup saved no profile");
    }

    app.quit();
  } catch (error) {
    console.error(`[smoke] setup failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function runSettingsSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] settings start");

    await window.webContents.executeJavaScript(
      'document.getElementById("settings-toggle")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "settings", 3000))) {
      throw new Error("settings screen did not open");
    }

    const summary = (await window.webContents.executeJavaScript(`({
      profiles: document.querySelectorAll(".settings-profile").length,
      lockState: document.getElementById("settings-lock-state")?.textContent || "",
    })`)) as { profiles: number; lockState: string };
    console.log(
      `[smoke] settings profiles=${summary.profiles} lock=${JSON.stringify(summary.lockState)}`,
    );
    if (summary.profiles < 1) {
      throw new Error("no profile editor in settings");
    }

    await window.webContents.executeJavaScript(
      `(() => {
        const set = (id, value) => {
          const node = document.getElementById(id);
          if (node) node.value = value;
        };
        set("settings-new-password", "smoke-pass");
        set("settings-new-password-confirm", "smoke-pasx");
        document.getElementById("settings-password-form")?.requestSubmit();
      })()`,
      true,
    );
    if (!(await waitForText(window, "settings-password-error", "Passwords do not match.", 3000))) {
      throw new Error("mismatched passwords were not rejected");
    }
    console.log("[smoke] settings confirm mismatch rejected");

    const seeded = await control?.status();
    const originalName = seeded?.profiles[0]?.name;
    if (!originalName) {
      throw new Error("the seeded profile is missing");
    }

    await window.webContents.executeJavaScript(
      `(() => {
        const input = document.querySelector(".settings-profile-name");
        if (input) input.value = "Home edited";
        document.querySelector(".settings-profile-save")?.click();
      })()`,
      true,
    );
    if (!(await waitForProfileName("Home edited", 5000))) {
      throw new Error("profile rename was not saved");
    }
    if (!(await waitForProfileSaveIdle(window, 3000))) {
      throw new Error("the profile save button stayed busy");
    }
    console.log("[smoke] settings profile rename saved");

    await window.webContents.executeJavaScript(
      `(() => {
        const input = document.querySelector(".settings-profile-name");
        if (input) input.value = ${JSON.stringify(originalName)};
        document.querySelector(".settings-profile-save")?.click();
      })()`,
      true,
    );
    if (!(await waitForProfileName(originalName, 5000))) {
      throw new Error("profile rename was not restored");
    }
    if (!(await waitForProfileSaveIdle(window, 3000))) {
      throw new Error("the profile save button stayed busy after restoring the name");
    }

    await window.webContents.executeJavaScript(
      `(() => {
        const set = (id, value) => {
          const node = document.getElementById(id);
          if (node) node.value = value;
        };
        set("settings-new-password", "smoke-pass");
        set("settings-new-password-confirm", "smoke-pass");
        document.getElementById("settings-password-form")?.requestSubmit();
      })()`,
      true,
    );
    if (!(await waitForPasswordProtected(true, 8000))) {
      throw new Error("the app lock did not turn on");
    }
    if (!(await waitForText(window, "settings-password-note", "App lock is on", 3000))) {
      throw new Error("the app lock confirmation did not appear");
    }
    console.log("[smoke] settings lock on");

    await window.webContents.executeJavaScript(
      'document.getElementById("settings-back")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "main", 3000))) {
      throw new Error("could not return to the dashboard list");
    }

    await window.webContents.executeJavaScript(
      'document.getElementById("lock-button")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "lock", 5000))) {
      throw new Error("the lock screen did not open");
    }

    await window.webContents.executeJavaScript(
      `(() => {
        const node = document.getElementById("lock-password");
        if (node) node.value = "smoke-pass";
        document.getElementById("lock-form")?.requestSubmit();
      })()`,
      true,
    );
    if (!(await waitForScreen(window, "main", 8000))) {
      throw new Error("unlock with the new password failed");
    }
    console.log("[smoke] settings lock/unlock ok");

    await window.webContents.executeJavaScript(
      'document.getElementById("settings-toggle")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "settings", 3000))) {
      throw new Error("settings did not reopen");
    }

    const lockUI = (await window.webContents.executeJavaScript(`({
      oldHidden: document.getElementById("settings-old-password-field")?.hidden,
      removeHidden: document.getElementById("settings-password-remove")?.hidden,
    })`)) as { oldHidden: boolean; removeHidden: boolean };
    if (lockUI.oldHidden !== false || lockUI.removeHidden !== false) {
      throw new Error("the app lock controls are not visible");
    }

    await window.webContents.executeJavaScript(
      `(() => {
        window.confirm = () => true;
        const node = document.getElementById("settings-old-password");
        if (node) node.value = "smoke-pass";
        document.getElementById("settings-password-remove")?.click();
      })()`,
      true,
    );
    if (!(await waitForPasswordProtected(false, 8000))) {
      throw new Error("the app lock did not turn off");
    }
    if (!(await waitForText(window, "settings-password-note", "App lock is off", 3000))) {
      throw new Error("the app lock removal confirmation did not appear");
    }
    console.log("[smoke] settings lock off");

    app.quit();
  } catch (error) {
    console.error(`[smoke] settings failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function waitForScreen(
  window: BrowserWindow,
  name: string,
  timeoutMs: number,
): Promise<boolean> {
  return waitForCondition(async () => {
    const screen = (await window.webContents.executeJavaScript(
      'document.body.dataset.screen || ""',
    )) as string;
    return screen === name;
  }, timeoutMs);
}

async function waitForText(
  window: BrowserWindow,
  id: string,
  expected: string,
  timeoutMs: number,
): Promise<boolean> {
  return waitForCondition(async () => {
    const text = (await window.webContents.executeJavaScript(
      `document.getElementById(${JSON.stringify(id)})?.textContent || ""`,
    )) as string;
    return text.includes(expected);
  }, timeoutMs);
}

async function waitForProfileSaveIdle(
  window: BrowserWindow,
  timeoutMs: number,
): Promise<boolean> {
  return waitForCondition(async () => {
    const idle = (await window.webContents.executeJavaScript(
      '(() => { const button = document.querySelector(".settings-profile-save"); return !!button && !button.disabled; })()',
    )) as boolean;
    return idle;
  }, timeoutMs);
}

async function waitForProfileName(name: string, timeoutMs: number): Promise<boolean> {
  return waitForCondition(async () => {
    const state = await control?.status();
    return state?.profiles[0]?.name === name;
  }, timeoutMs);
}

async function waitForPasswordProtected(
  protectedState: boolean,
  timeoutMs: number,
): Promise<boolean> {
  return waitForCondition(async () => {
    const state = await control?.status();
    return state?.password_protected === protectedState;
  }, timeoutMs);
}

async function waitForCondition(
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await delay(50);
  }
  return false;
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
