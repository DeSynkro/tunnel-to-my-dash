import { randomBytes } from "node:crypto";
import { app, BrowserWindow, Menu, session } from "electron";
import path from "node:path";
import { ControlClient } from "./control-client";
import { CoreProcess } from "./core-process";
import { resolveDataRoot } from "./data-dir";
import { registerIpc } from "./ipc";

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
app.commandLine.appendSwitch("no-pings");
app.commandLine.appendSwitch("disable-breakpad");
app.commandLine.appendSwitch(
  "disable-features",
  "SafeBrowsing,OptimizationHints,MediaRouter,Translate,AutofillServerCommunication,InterestFeedContentSuggestions",
);

let control: ControlClient | null = null;
let coreError: string | null = null;
let core: CoreProcess | null = null;
let mainWindow: BrowserWindow | null = null;

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

  if (process.env.TTMD_SMOKE === "1") {
    mainWindow.webContents.once("did-finish-load", () => {
      if (mainWindow) {
        void runSmoke(mainWindow);
      }
    });
  }
}

async function runSmoke(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + 10_000;
  let submitted = false;

  while (Date.now() < deadline) {
    try {
      const state = (await window.webContents.executeJavaScript(`({
        screen: document.body.dataset.screen || "",
        profiles: document.querySelectorAll(".profile").length,
        error: document.getElementById("setup-error")?.textContent || "",
      })`)) as { screen: string; profiles: number; error: string };

      if (!submitted && state.screen === "setup") {
        await submitSmokeSetup(window);
        submitted = true;
        continue;
      }

      if (state.screen === "main") {
        console.log(`[smoke] screen=main profiles=${state.profiles}`);
        if (state.profiles < 1) {
          process.exitCode = 1;
        }
        app.quit();
        return;
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

  await startCore();
  registerIpc({ control, coreError, getWindow: () => mainWindow });
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
