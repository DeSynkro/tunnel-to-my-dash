import { createHash, randomBytes } from "node:crypto";
import {
  app,
  BaseWindow,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  session,
  WebContentsView,
  type WebPreferences,
} from "electron";
import path from "node:path";
import { IPC } from "../shared/ipc";
import type {
  AutofillResult,
  ConnectResult,
  CredentialField,
  CredentialSummary,
  LoginCandidate,
  PointerPayload,
  Status,
} from "../shared/types";
import { ControlClient } from "./control-client";
import { CoreProcess } from "./core-process";
import { resolveDataRoot } from "./data-dir";
import { registerIpc, type NavigationActions } from "./ipc";
import { isPrivateHttpUrl } from "./private-url";
import { SettingsStore } from "./settings";

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
const settingsStore = new SettingsStore(dataRoot);
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
let dashboardLock: WebContentsView | null = null;
let dashboardHomeURL = "";
let dashboardPartition = "";
let dashboardPasswordProtected = false;
let dashboardLocked = false;
let dashboardClosingToMain = false;
let dashboardAutoHide = true;
let dashboardProfileID: string | null = null;
let suppressAutoOpenOnce = false;

const toolbarHeight = 36;
const toolbarExpandedTop = 8;
const toolbarExpandedGap = 4;
const toolbarSideMargin = 32;
const toolbarMaxWidth = 720;
const toolbarMinWidth = 360;
const toolbarRadius = 12;
const peekWidth = 72;
const peekHeight = 6;
const peekTop = 6;
const peekRadius = 3;
const toolbarAnimationMs = 180;
const toolbarHideDelay = 900;
const toolbarPollInterval = 100;
const toolbarPanelGap = 4;
const toolbarPanelMaxHeight = 300;

const clipboardClearMs = (() => {
  if (!process.env.TTMD_SMOKE) {
    return 30_000;
  }
  const value = Number(process.env.TTMD_CLIPBOARD_MS);
  return Number.isFinite(value) && value > 0 ? value : 30_000;
})();

let toolbarVisible = true;
let toolbarPointerOver = false;
let toolbarLeftAt = 0;
let toolbarInitialUntil = 0;
let toolbarPanelOpen = false;
let toolbarPanelHeight = 0;
let toolbarAnimation: ReturnType<typeof setInterval> | null = null;
let toolbarPoll: ReturnType<typeof setInterval> | null = null;
let idleMonitor: ReturnType<typeof setInterval> | null = null;
let clipboardTimer: ReturnType<typeof setTimeout> | null = null;
let clipboardValue = "";
let clipboardGeneration = 0;
let clipboardPending = 0;
let clipboardQueue: Promise<void> = Promise.resolve();
let vaultLockEpoch = 0;
let quitting = false;
const skippedLogins = new Set<string>();
let loginPromptOpen = false;
const loginSuccessWindowMs = 15_000;
let pendingLogin: { candidate: LoginCandidate; path: string } | null = null;
let pendingLoginTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFills = new Map<string, (result: AutofillResult) => void>();

type ToolbarRect = { x: number; y: number; width: number; height: number };

function toolbarExpandedRect(): ToolbarRect {
  if (!dashboardWindow) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const { width } = dashboardWindow.getContentBounds();
  const barWidth = Math.max(
    toolbarMinWidth,
    Math.min(toolbarMaxWidth, width - toolbarSideMargin * 2),
  );
  return {
    x: Math.round((width - barWidth) / 2),
    y: toolbarExpandedTop,
    width: barWidth,
    height: toolbarHeight,
  };
}

function toolbarPeekRect(): ToolbarRect {
  if (!dashboardWindow) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const { width } = dashboardWindow.getContentBounds();
  return {
    x: Math.round((width - peekWidth) / 2),
    y: peekTop,
    width: peekWidth,
    height: peekHeight,
  };
}

function toolbarFixedRect(): ToolbarRect {
  if (!dashboardWindow) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const { width } = dashboardWindow.getContentBounds();
  return { x: 0, y: 0, width, height: toolbarHeight };
}

function dashboardPageOffset(): number {
  return dashboardAutoHide ? 0 : toolbarHeight;
}

function applyToolbarFrame(rect: ToolbarRect, radius: number): void {
  if (!dashboardWindow) {
    return;
  }
  const extended = { ...rect };
  if (toolbarPanelOpen && toolbarPanelHeight > 0 && rect.height > peekHeight) {
    extended.height = rect.height + toolbarPanelGap + toolbarPanelHeight;
  }
  dashboardToolbar?.setBounds(extended);
  dashboardToolbar?.setBorderRadius(radius);
  const { width, height } = dashboardWindow.getContentBounds();
  const offset = dashboardPageOffset();
  dashboardView?.setBounds({
    x: 0,
    y: offset,
    width,
    height: Math.max(0, height - offset),
  });
  dashboardLock?.setBounds({ x: 0, y: 0, width, height });
}

function stopToolbarAnimation(): void {
  if (toolbarAnimation) {
    clearInterval(toolbarAnimation);
    toolbarAnimation = null;
  }
}

function animateToolbar(expanded: boolean): void {
  if (!dashboardWindow || !dashboardToolbar) {
    return;
  }
  stopToolbarAnimation();

  const wasExpanded = toolbarVisible;
  const from = wasExpanded ? toolbarExpandedRect() : toolbarPeekRect();
  const to = expanded ? toolbarExpandedRect() : toolbarPeekRect();
  const fromRadius = wasExpanded ? toolbarRadius : peekRadius;
  const toRadius = expanded ? toolbarRadius : peekRadius;
  const start = Date.now();

  toolbarVisible = expanded;
  sendNavState();

  if (
    from.x === to.x &&
    from.y === to.y &&
    from.width === to.width &&
    from.height === to.height
  ) {
    applyToolbarFrame(to, toRadius);
    return;
  }

  toolbarAnimation = setInterval(() => {
    if (!dashboardWindow || !dashboardToolbar) {
      stopToolbarAnimation();
      return;
    }

    const t = Math.min(1, (Date.now() - start) / toolbarAnimationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const rect: ToolbarRect = {
      x: Math.round(from.x + (to.x - from.x) * eased),
      y: Math.round(from.y + (to.y - from.y) * eased),
      width: Math.round(from.width + (to.width - from.width) * eased),
      height: Math.round(from.height + (to.height - from.height) * eased),
    };
    const radius = Math.round(fromRadius + (toRadius - fromRadius) * eased);
    applyToolbarFrame(rect, radius);

    if (t >= 1) {
      stopToolbarAnimation();
      applyToolbarFrame(to, toRadius);
    }
  }, 16);
}

function setToolbarExpanded(expanded: boolean): void {
  if (!dashboardAutoHide || !dashboardToolbar || toolbarVisible === expanded) {
    return;
  }
  if (!expanded) {
    toolbarPointerOver = false;
    toolbarLeftAt = 0;
  }
  animateToolbar(expanded);
}

function layoutDashboard(): void {
  if (!dashboardWindow) {
    return;
  }
  stopToolbarAnimation();
  if (!dashboardAutoHide) {
    applyToolbarFrame(toolbarFixedRect(), 0);
    return;
  }
  const rect = toolbarVisible ? toolbarExpandedRect() : toolbarPeekRect();
  applyToolbarFrame(rect, toolbarVisible ? toolbarRadius : peekRadius);
}

function sendToolbarPanelState(open: boolean): void {
  dashboardToolbar?.webContents.send(IPC.toolbarPanelState, { open });
}

function closeToolbarPanel(): void {
  if (!toolbarPanelOpen) {
    return;
  }
  toolbarPanelOpen = false;
  toolbarPanelHeight = 0;
  sendToolbarPanelState(false);
  layoutDashboard();
}

function setToolbarPanel(open: boolean, height: number): void {
  if (!dashboardToolbar || dashboardLocked) {
    return;
  }
  if (!open) {
    closeToolbarPanel();
    return;
  }
  toolbarPanelOpen = true;
  toolbarPanelHeight = Math.max(80, Math.min(Math.round(height), toolbarPanelMaxHeight));
  if (dashboardAutoHide) {
    setToolbarExpanded(true);
  }
  layoutDashboard();
}

function enqueueClipboard(operation: () => Promise<void>): Promise<void> {
  const run = clipboardQueue.then(operation, operation);
  clipboardQueue = run.catch(() => undefined);
  return run;
}

async function clearClipboardNow(): Promise<void> {
  if (clipboardTimer) {
    clearTimeout(clipboardTimer);
    clipboardTimer = null;
  }
  if (!clipboardValue) {
    return;
  }
  const ours = clipboardValue;
  clipboardValue = "";
  try {
    if ((await clipboard.readText()) === ours) {
      clipboard.clear();
    }
  } catch {
    // The clipboard is best effort; never block the app on it.
  }
}

function clearClipboardIfOurs(): Promise<void> {
  clipboardGeneration += 1;
  if (clipboardTimer) {
    clearTimeout(clipboardTimer);
    clipboardTimer = null;
  }
  return enqueueClipboard(clearClipboardNow);
}

function copyToClipboard(value: string, epoch: number): Promise<void> {
  clipboardPending += 1;
  return enqueueClipboard(async () => {
    try {
      if (epoch !== vaultLockEpoch) {
        throw new Error("The dashboard is locked.");
      }
      await clearClipboardNow();
      await clipboard.writeText(value);
      if (epoch !== vaultLockEpoch) {
        if ((await clipboard.readText().catch(() => "")) === value) {
          clipboard.clear();
        }
        throw new Error("The dashboard is locked.");
      }

      clipboardValue = value;
      const generation = ++clipboardGeneration;
      if (clipboardTimer) {
        clearTimeout(clipboardTimer);
      }
      clipboardTimer = setTimeout(() => {
        clipboardTimer = null;
        void enqueueClipboard(async () => {
          if (generation !== clipboardGeneration) {
            return;
          }
          await clearClipboardNow();
        });
      }, clipboardClearMs);
      clipboardTimer.unref?.();
    } finally {
      clipboardPending -= 1;
    }
  });
}

async function lockVault(): Promise<Status> {
  const client = control;
  if (!client) {
    throw new Error("The core is not ready.");
  }
  vaultLockEpoch += 1;
  await clearClipboardIfOurs();
  return client.lock();
}

function toolbarPanelArg(value: unknown): { open: boolean; height: number } {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request.");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.open !== "boolean") {
    throw new Error("Invalid request.");
  }
  const height =
    typeof raw.height === "number" && Number.isFinite(raw.height) ? raw.height : 0;
  return { open: raw.open, height };
}

function isCredentialField(value: unknown): value is CredentialField {
  return value === "username" || value === "password";
}

function stopToolbarPoll(): void {
  if (toolbarPoll) {
    clearInterval(toolbarPoll);
    toolbarPoll = null;
  }
  stopToolbarAnimation();
  toolbarPointerOver = false;
  toolbarLeftAt = 0;
  toolbarInitialUntil = 0;
}

function handleToolbarPointer(payload: PointerPayload): void {
  toolbarPointerOver = !payload.out;
  if (
    toolbarPointerOver &&
    !toolbarVisible &&
    dashboardAutoHide &&
    !dashboardLocked
  ) {
    toolbarInitialUntil = 0;
    setToolbarExpanded(true);
  }
}

ipcMain.on(IPC.pointerToolbar, (event, payload: PointerPayload) => {
  if (event.sender !== dashboardToolbar?.webContents) {
    return;
  }
  handleToolbarPointer(payload);
});

ipcMain.handle(IPC.toolbarPanel, (event, payload: unknown) => {
  if (event.sender !== dashboardToolbar?.webContents) {
    throw new Error("Invalid request.");
  }
  const { open, height } = toolbarPanelArg(payload);
  setToolbarPanel(open, height);
});

ipcMain.handle(
  IPC.toolbarCopyCredential,
  async (event, credentialID: unknown, field: unknown) => {
    if (event.sender !== dashboardToolbar?.webContents) {
      throw new Error("Invalid request.");
    }
    if (typeof credentialID !== "string" || !isCredentialField(field)) {
      throw new Error("Invalid request.");
    }
    const profileID = dashboardProfileID;
    const epoch = vaultLockEpoch;
    if (!control || !profileID) {
      throw new Error("No dashboard is open.");
    }

    const secret = await control.credentialSecret(profileID, credentialID);
    if (
      dashboardLocked ||
      dashboardProfileID !== profileID ||
      epoch !== vaultLockEpoch
    ) {
      throw new Error("The dashboard is locked.");
    }
    const value = field === "username" ? secret.username : secret.password;
    if (!value) {
      throw new Error(
        field === "username"
          ? "No username saved for that login."
          : "No password saved for that login.",
      );
    }
    await copyToClipboard(value, epoch);
  },
);

ipcMain.handle(
  IPC.toolbarFillCredential,
  async (event, credentialID: unknown) => {
    if (event.sender !== dashboardToolbar?.webContents) {
      throw new Error("Invalid request.");
    }
    if (typeof credentialID !== "string") {
      throw new Error("Invalid request.");
    }
    const profileID = dashboardProfileID;
    const view = dashboardView;
    const epoch = vaultLockEpoch;
    if (!control || !profileID || !view) {
      throw new Error("No dashboard is open.");
    }
    if (dashboardLocked) {
      throw new Error("The dashboard is locked.");
    }

    const page = view.webContents.getURL();
    if (!isPrivateHttpUrl(page)) {
      throw new Error("This page has no login form.");
    }
    let pageOrigin = "";
    try {
      pageOrigin = new URL(page).origin;
    } catch {
      throw new Error("This page has no login form.");
    }

    let credential: CredentialSummary | undefined;
    try {
      const credentials = await control.listCredentials(profileID);
      credential = credentials.find((item) => item.id === credentialID);
    } catch (error) {
      throw new Error(`Could not load the saved login: ${errorMessage(error)}`);
    }
    if (!credential) {
      throw new Error("That saved login no longer exists.");
    }
    if (normalizedOrigin(credential.url ?? "") !== pageOrigin) {
      throw new Error("That saved login is for a different page.");
    }

    let secret;
    try {
      secret = await control.credentialSecret(profileID, credentialID);
    } catch (error) {
      throw new Error(`Could not read the saved login: ${errorMessage(error)}`);
    }
    if (
      dashboardLocked ||
      dashboardProfileID !== profileID ||
      epoch !== vaultLockEpoch
    ) {
      throw new Error("The dashboard is locked.");
    }

    const result = await fillDashboardLogin(secret.username, secret.password);
    if (!result.ok) {
      throw new Error("No login form found on this page.");
    }
  },
);

ipcMain.handle(
  IPC.toolbarDeleteCredential,
  async (event, credentialID: unknown) => {
    if (event.sender !== dashboardToolbar?.webContents) {
      throw new Error("Invalid request.");
    }
    if (typeof credentialID !== "string") {
      throw new Error("Invalid request.");
    }
    const profileID = dashboardProfileID;
    if (!control || !profileID || dashboardLocked) {
      throw new Error("No dashboard is open.");
    }
    await control.deleteCredential(profileID, credentialID);
    await loadToolbarCredentials();
  },
);

ipcMain.on(IPC.loginCandidate, (event, payload: unknown) => {
  if (!dashboardView || event.sender !== dashboardView.webContents) {
    return;
  }
  if (event.senderFrame !== dashboardView.webContents.mainFrame) {
    return;
  }
  if (dashboardLocked || !dashboardProfileID || !control) {
    return;
  }
  const candidate = loginCandidateArg(payload);
  if (!candidate) {
    return;
  }
  queueLoginCandidate(candidate);
});

ipcMain.on(IPC.autofillResult, (event, requestID: unknown, result: unknown) => {
  if (!dashboardView || event.sender !== dashboardView.webContents) {
    return;
  }
  if (event.senderFrame !== dashboardView.webContents.mainFrame) {
    return;
  }
  if (typeof requestID !== "string" || typeof result !== "object" || result === null) {
    return;
  }
  const raw = result as Record<string, unknown>;
  if (
    typeof raw.ok !== "boolean" ||
    typeof raw.username !== "boolean" ||
    typeof raw.password !== "boolean"
  ) {
    return;
  }
  const resolve = pendingFills.get(requestID);
  if (!resolve) {
    return;
  }
  pendingFills.delete(requestID);
  resolve({ ok: raw.ok, username: raw.username, password: raw.password });
});

ipcMain.handle(IPC.inlineFillAvailable, async (event) => {
  if (
    !dashboardView ||
    event.sender !== dashboardView.webContents ||
    event.senderFrame !== dashboardView.webContents.mainFrame
  ) {
    throw new Error("Invalid request.");
  }
  const profileID = dashboardProfileID;
  if (!control || !profileID || dashboardLocked) {
    return { available: false };
  }
  const origin = dashboardOrigin();
  if (!origin) {
    return { available: false };
  }
  try {
    const match = await matchingCredentialForPage(control, profileID, origin);
    return match
      ? { available: true, name: match.name }
      : { available: false };
  } catch {
    return { available: false };
  }
});

ipcMain.handle(IPC.inlineFill, async (event) => {
  if (
    !dashboardView ||
    event.sender !== dashboardView.webContents ||
    event.senderFrame !== dashboardView.webContents.mainFrame
  ) {
    throw new Error("Invalid request.");
  }
  const profileID = dashboardProfileID;
  const epoch = vaultLockEpoch;
  if (!control || !profileID || dashboardLocked) {
    return { ok: false };
  }
  const origin = dashboardOrigin();
  if (!origin) {
    return { ok: false };
  }
  try {
    const match = await matchingCredentialForPage(control, profileID, origin);
    if (!match) {
      return { ok: false };
    }
    const secret = await control.credentialSecret(profileID, match.id);
    if (
      dashboardLocked ||
      dashboardProfileID !== profileID ||
      epoch !== vaultLockEpoch
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      username: secret.username,
      password: secret.password,
    };
  } catch {
    return { ok: false };
  }
});

function startIdleMonitor(): void {
  stopIdleMonitor();
  idleMonitor = setInterval(() => {
    void checkIdle();
  }, 10_000);
}

function stopIdleMonitor(): void {
  if (idleMonitor) {
    clearInterval(idleMonitor);
    idleMonitor = null;
  }
}

async function checkIdle(): Promise<void> {
  if (!control) {
    return;
  }

  let status;
  try {
    status = await control.status();
  } catch {
    return;
  }
  if (!status.password_protected || status.locked || !status.security?.lock_after_idle) {
    return;
  }
  const idleOverride = Number(process.env.TTMD_IDLE_MS ?? "");
  const thresholdSeconds =
    Number.isFinite(idleOverride) && idleOverride > 0
      ? idleOverride / 1000
      : status.security.idle_minutes * 60;
  if (powerMonitor.getSystemIdleTime() < thresholdSeconds) {
    return;
  }

  if (dashboardWindow) {
    if (dashboardLocked || dashboardView?.webContents.isCurrentlyAudible()) {
      return;
    }
    await lockDashboard();
    return;
  }

  if (!mainWindow?.isVisible()) {
    return;
  }
  try {
    await lockVault();
  } catch {
    return;
  }
  mainWindow.webContents.send(IPC.statusChanged);
}

function startToolbarPoll(): void {
  stopToolbarPoll();
  toolbarVisible = true;
  toolbarPointerOver = false;
  toolbarInitialUntil = Date.now() + 1500;
  dashboardToolbar?.setVisible(true);
  applyToolbarFrame(toolbarExpandedRect(), toolbarRadius);
  sendNavState();

  toolbarPoll = setInterval(() => {
    if (!dashboardWindow || !dashboardToolbar) {
      return;
    }

    if (!dashboardWindow.isFocused()) {
      closeToolbarPanel();
      if (toolbarVisible) {
        setToolbarExpanded(false);
      }
      toolbarPointerOver = false;
      toolbarLeftAt = 0;
      return;
    }

    if (toolbarPanelOpen) {
      return;
    }

    if (!toolbarVisible) {
      return;
    }
    if (toolbarPointerOver) {
      toolbarLeftAt = 0;
      return;
    }

    const now = Date.now();
    if (now < toolbarInitialUntil) {
      toolbarLeftAt = 0;
      return;
    }
    if (toolbarLeftAt === 0) {
      toolbarLeftAt = now;
    }
    if (now - toolbarLeftAt >= toolbarHideDelay) {
      toolbarLeftAt = 0;
      setToolbarExpanded(false);
    }
  }, toolbarPollInterval);
}

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
    preload: path.join(__dirname, "dashboard-preload.js"),
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
    passwordProtected: dashboardPasswordProtected,
    mode: !dashboardAutoHide ? "fixed" : toolbarVisible ? "floating" : "peek",
  });
}

async function loadToolbarCredentials(): Promise<void> {
  const profileID = dashboardProfileID;
  const toolbar = dashboardToolbar;
  if (!profileID || !toolbar) {
    return;
  }
  try {
    const credentials = (await control?.listCredentials(profileID)) ?? [];
    if (dashboardProfileID !== profileID || dashboardToolbar !== toolbar) {
      return;
    }
    toolbar.webContents.send(IPC.toolbarCredentials, { credentials });
  } catch (error) {
    console.error(`[credentials] ${errorMessage(error)}`);
  }
}

function loginCandidateArg(value: unknown): LoginCandidate | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.url !== "string" ||
    typeof raw.page !== "string" ||
    typeof raw.title !== "string" ||
    typeof raw.username !== "string" ||
    typeof raw.password !== "string"
  ) {
    return null;
  }
  if (raw.password === "" || raw.password.length > 4096) {
    return null;
  }
  if (
    raw.username.length > 256 ||
    raw.title.length > 200 ||
    raw.url.length > 2048 ||
    raw.page.length > 2048
  ) {
    return null;
  }

  let url: URL;
  let page: URL;
  try {
    url = new URL(raw.url);
    page = new URL(raw.page);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    page.origin !== url.origin
  ) {
    return null;
  }
  if (!isPrivateHttpUrl(page.toString())) {
    return null;
  }

  return {
    url: url.origin,
    page: page.toString(),
    title: raw.title.trim(),
    username: raw.username.trim(),
    password: raw.password,
  };
}

function credentialName(title: string, url: string): string {
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

function normalizedOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function dashboardOrigin(): string | null {
  const view = dashboardView;
  if (!view) {
    return null;
  }
  const page = view.webContents.getURL();
  if (!isPrivateHttpUrl(page)) {
    return null;
  }
  try {
    return new URL(page).origin;
  } catch {
    return null;
  }
}

async function matchingCredentialForPage(
  client: ControlClient,
  profileID: string,
  origin: string,
): Promise<CredentialSummary | null> {
  const credentials = await client.listCredentials(profileID);
  const matches = credentials.filter(
    (credential) => normalizedOrigin(credential.url ?? "") === origin,
  );
  if (matches.length <= 1) {
    return matches[0] ?? null;
  }
  const title = dashboardView?.webContents.getTitle() ?? "";
  const name = credentialName(title, origin).toLowerCase();
  return (
    matches.find((match) => match.name.toLowerCase() === name) ?? matches[0]
  );
}

function clearPendingLogin(): void {
  if (pendingLoginTimer) {
    clearTimeout(pendingLoginTimer);
    pendingLoginTimer = null;
  }
  pendingLogin = null;
}

function fillDashboardLogin(
  username: string,
  password: string,
): Promise<AutofillResult> {
  const view = dashboardView;
  if (!view) {
    return Promise.resolve({ ok: false, username: false, password: false });
  }

  const requestID = randomBytes(8).toString("hex");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingFills.delete(requestID);
      resolve({ ok: false, username: false, password: false });
    }, 2000);
    pendingFills.set(requestID, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    view.webContents.send(IPC.autofillLogin, {
      id: requestID,
      username,
      password,
    });
  });
}

function queueLoginCandidate(candidate: LoginCandidate): void {
  clearPendingLogin();
  let path = "/";
  try {
    path = new URL(candidate.page).pathname;
  } catch {
    return;
  }
  pendingLogin = { candidate, path };
  pendingLoginTimer = setTimeout(clearPendingLogin, loginSuccessWindowMs);
  pendingLoginTimer.unref?.();
}

function handleLoginNavigation(): void {
  const pending = pendingLogin;
  if (!pending || !dashboardView) {
    return;
  }
  let path = "";
  try {
    path = new URL(dashboardView.webContents.getURL()).pathname;
  } catch {
    return;
  }
  if (!path) {
    return;
  }
  clearPendingLogin();
  if (path !== pending.path) {
    void handleLoginCandidate(pending.candidate);
  }
}

async function showAmbiguousLogin(matches: CredentialSummary[]): Promise<void> {
  const options = {
    type: "warning" as const,
    buttons: ["OK"],
    title: "Multiple saved logins",
    message: "More than one saved login matches this page.",
    detail: `Edit them in the profile to choose which one to update.\n${matches
      .map((match) => `• ${match.name}`)
      .join("\n")}`,
  };
  const parent = dashboardWindow;
  if (parent) {
    await dialog.showMessageBox(parent, options);
  } else {
    await dialog.showMessageBox(options);
  }
}

async function showSaveFailure(): Promise<void> {
  if (process.env.TTMD_SMOKE) {
    return;
  }
  const options = {
    type: "error" as const,
    buttons: ["OK"],
    title: "Could not save password",
    message: "The saved login was not accepted.",
    detail: "Try again from Edit profile → Passwords.",
  };
  const parent = dashboardWindow;
  if (parent) {
    await dialog.showMessageBox(parent, options);
  } else {
    await dialog.showMessageBox(options);
  }
}

async function handleLoginCandidate(candidate: LoginCandidate): Promise<void> {
  if (loginPromptOpen) {
    return;
  }
  const profileID = dashboardProfileID;
  const client = control;
  if (!profileID || !client) {
    return;
  }

  const skipKey = `${candidate.url}\n${candidate.username}\n${createHash(
    "sha256",
  )
    .update(candidate.password)
    .digest("hex")}`;
  if (skippedLogins.has(skipKey)) {
    return;
  }

  loginPromptOpen = true;
  try {
    let matches: CredentialSummary[] = [];
    try {
      const credentials = await client.listCredentials(profileID);
      matches = credentials.filter(
        (credential) =>
          normalizedOrigin(credential.url ?? "") === candidate.url &&
          (credential.username ?? "") === candidate.username,
      );
    } catch (error) {
      console.error(`[credentials] lookup: ${errorMessage(error)}`);
      return;
    }

    let existing: CredentialSummary | null = null;
    if (matches.length === 1) {
      existing = matches[0];
    } else if (matches.length > 1) {
      const name = credentialName(candidate.title, candidate.url).toLowerCase();
      const named = matches.filter(
        (match) => match.name.toLowerCase() === name,
      );
      if (named.length === 1) {
        existing = named[0];
      } else {
        await showAmbiguousLogin(matches);
        return;
      }
    }

    if (existing) {
      try {
        const secret = await client.credentialSecret(profileID, existing.id);
        if (secret.password === candidate.password) {
          return;
        }
      } catch (error) {
        console.error(`[credentials] lookup: ${errorMessage(error)}`);
        return;
      }
    }

    const name = credentialName(candidate.title, candidate.url);
    const savePrompt = process.env.TTMD_SMOKE
      ? process.env.TTMD_SAVE_PROMPT
      : undefined;
    let response = 0;
    if (savePrompt === "accept") {
      response = 0;
    } else if (savePrompt === "decline") {
      response = 1;
    } else {
      const options = {
        type: "question" as const,
        buttons: ["Save password", "Not now"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: existing ? "Update saved password?" : "Save password?",
        message: existing
          ? `Update the saved password for “${existing.name}”?`
          : `Save login for “${name}”?`,
        detail: candidate.username
          ? `${candidate.url}\nUsername: ${candidate.username}`
          : candidate.url,
      };
      const parent = dashboardWindow;
      const result = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      response = result.response;
    }

    if (
      !dashboardProfileID ||
      dashboardProfileID !== profileID ||
      dashboardLocked
    ) {
      return;
    }

    if (response !== 0) {
      skippedLogins.add(skipKey);
      return;
    }

    try {
      if (existing) {
        await client.updateCredential(profileID, existing.id, {
          name: existing.name,
          url: candidate.url,
          username: candidate.username,
          password: candidate.password,
        });
      } else {
        await client.addCredential(profileID, {
          name,
          url: candidate.url,
          username: candidate.username,
          password: candidate.password,
        });
      }
      void loadToolbarCredentials();
      console.log("[credentials] saved");
    } catch (error) {
      console.error(`[credentials] save: ${errorMessage(error)}`);
      await showSaveFailure();
    }
  } finally {
    loginPromptOpen = false;
  }
}

const navigation: NavigationActions = {
  back: () => {
    dashboardView?.webContents.navigationHistory.goBack();
    dashboardView?.webContents.focus();
  },
  forward: () => {
    dashboardView?.webContents.navigationHistory.goForward();
    dashboardView?.webContents.focus();
  },
  reload: () => {
    dashboardView?.webContents.reload();
    dashboardView?.webContents.focus();
  },
  home: () => {
    if (dashboardView) {
      void dashboardView.webContents.loadURL(dashboardHomeURL);
      dashboardView.webContents.focus();
    }
  },
  backToApp: () => {
    if (dashboardWindow) {
      dashboardClosingToMain = true;
      if (dashboardLocked) {
        suppressAutoOpenOnce = true;
      }
      dashboardWindow.close();
    }
  },
  lock: () => {
    void lockDashboard();
  },
};

async function lockDashboard(): Promise<void> {
  if (
    !dashboardWindow ||
    !dashboardView ||
    !dashboardToolbar ||
    !dashboardLock ||
    dashboardLocked ||
    !dashboardPasswordProtected
  ) {
    return;
  }

  dashboardLocked = true;
  stopToolbarPoll();
  closeToolbarPanel();
  skippedLogins.clear();
  clearPendingLogin();

  let snapshot = "";
  try {
    const image = await dashboardView.webContents.capturePage();
    if (!image.isEmpty()) {
      snapshot = `data:image/jpeg;base64,${image.toJPEG(70).toString("base64")}`;
    }
  } catch (error) {
    console.error(`[lock] snapshot: ${errorMessage(error)}`);
  }

  try {
    await lockVault();
  } catch (error) {
    console.error(`[lock] ${errorMessage(error)}`);
  }

  dashboardView.setVisible(false);
  dashboardToolbar.setVisible(false);
  dashboardView.webContents.setAudioMuted(true);
  dashboardLock.setVisible(true);
  dashboardLock.webContents.focus();
  dashboardLock.webContents.send(IPC.dashboardLocked, snapshot);
}

async function unlockDashboard(password: string): Promise<void> {
  if (!dashboardLocked || !control) {
    throw new Error("The dashboard is not locked.");
  }

  await control.unlock(password);
  const status = await control.status();
  const profileID = status.active_profile;
  if (!profileID) {
    throw new Error("No dashboard profile is active");
  }

  const result = await control.connect(profileID);
  const dashboardSession = session.fromPartition(dashboardPartition);
  await dashboardSession.setProxy({
    proxyRules: `http=${result.proxy};https=${result.proxy}`,
  });

  dashboardHomeURL = result.dashboard_url;
  dashboardProfileID = profileID;
  clearPendingLogin();
  dashboardLocked = false;
  dashboardLock?.setVisible(false);
  dashboardView?.webContents.setAudioMuted(false);
  dashboardView?.setVisible(true);

  if (dashboardAutoHide) {
    startToolbarPoll();
  } else {
    toolbarVisible = true;
    dashboardToolbar?.setVisible(true);
    applyToolbarFrame(toolbarFixedRect(), 0);
    sendNavState();
  }
  void loadToolbarCredentials();

  if (dashboardView) {
    try {
      await dashboardView.webContents.loadURL(result.dashboard_url);
    } catch (error) {
      console.error(`[dashboard] ${errorMessage(error)}`);
    }
  }
}

async function openDashboard(profileID: string, result: ConnectResult): Promise<void> {
  if (dashboardWindow) {
    dashboardWindow.focus();
    return;
  }

  dashboardClosingToMain = false;
  dashboardLocked = false;
  dashboardProfileID = profileID;
  toolbarPanelOpen = false;
  toolbarPanelHeight = 0;
  skippedLogins.clear();
  loginPromptOpen = false;
  clearPendingLogin();
  console.log(`[dashboard] proxy=${result.proxy}`);

  const partition = `persist:profile-${profileID}`;
  dashboardPartition = partition;
  try {
    const vaultStatus = await control?.status();
    dashboardPasswordProtected = vaultStatus?.password_protected ?? false;
  } catch {
    dashboardPasswordProtected = false;
  }

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
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#0e0e0e",
  });

  const view = new WebContentsView({
    webPreferences: dashboardWebPreferences(partition),
  });
  const toolbar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "toolbar-preload.js"),
      transparent: true,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  toolbar.setBackgroundColor("#00000000");
  const lock = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "lock-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  lock.setVisible(false);

  window.contentView.addChildView(view);
  window.contentView.addChildView(toolbar);
  window.contentView.addChildView(lock);

  dashboardWindow = window;
  dashboardView = view;
  dashboardToolbar = toolbar;
  dashboardLock = lock;
  dashboardHomeURL = result.dashboard_url;
  dashboardAutoHide = settingsStore.get().auto_hide_toolbar;
  window.on("resize", layoutDashboard);
  window.on("focus", () => {
    if (!dashboardAutoHide || dashboardLocked) {
      return;
    }
    toolbarInitialUntil = Date.now() + 1500;
    setToolbarExpanded(true);
  });
  window.on("blur", () => closeToolbarPanel());

  if (dashboardAutoHide) {
    startToolbarPoll();
  } else {
    toolbarVisible = true;
    toolbar.setVisible(true);
    applyToolbarFrame(toolbarFixedRect(), 0);
    sendNavState();
  }

  void toolbar.webContents.loadFile(path.join(__dirname, "renderer/toolbar.html"));
  void lock.webContents.loadFile(path.join(__dirname, "renderer/lock.html"));
  toolbar.webContents.on("did-finish-load", () => {
    sendNavState();
    void loadToolbarCredentials();
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isPrivateHttpUrl(url)) {
      void view.webContents.loadURL(url);
    }
    return { action: "deny" };
  });
  view.webContents.on("will-navigate", (event, url) => {
    if (!isPrivateHttpUrl(url)) {
      event.preventDefault();
    }
  });
  view.webContents.on("focus", () => closeToolbarPanel());
  view.webContents.on("did-navigate", () => {
    closeToolbarPanel();
    handleLoginNavigation();
    sendNavState();
  });
  view.webContents.on("did-navigate-in-page", () => {
    closeToolbarPanel();
    handleLoginNavigation();
    sendNavState();
  });
  view.webContents.on("page-title-updated", (_event, title) => {
    window.setTitle(title ? `${title} — Tunnel to My Dash` : "Tunnel to My Dash");
  });

  window.on("closed", () => {
    stopToolbarPoll();
    const toMain = dashboardClosingToMain;
    dashboardClosingToMain = false;
    dashboardWindow = null;
    dashboardView = null;
    dashboardToolbar = null;
    dashboardLock = null;
    dashboardHomeURL = "";
    dashboardPartition = "";
    dashboardPasswordProtected = false;
    dashboardLocked = false;
    dashboardProfileID = null;
    toolbarPanelOpen = false;
    toolbarPanelHeight = 0;
    skippedLogins.clear();
    loginPromptOpen = false;
    clearPendingLogin();
    for (const resolve of pendingFills.values()) {
      resolve({ ok: false, username: false, password: false });
    }
    pendingFills.clear();

    if (control) {
      void control.disconnect().catch(() => undefined);
    }

    if (toMain) {
      if (mainWindow) {
        const suppress = suppressAutoOpenOnce;
        suppressAutoOpenOnce = false;
        mainWindow.show();
        void (async () => {
          if (suppress) {
            const status = await control?.status().catch(() => null);
            if (status?.locked) {
              mainWindow?.webContents.send(IPC.suppressAutoOpen);
            }
          }
          mainWindow?.webContents.send(IPC.statusChanged);
        })();
      }
    } else {
      app.quit();
    }
  });

  mainWindow?.hide();
  window.focus();

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
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#0e0e0e",
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
    process.env.TTMD_SMOKE === "setup" ||
    process.env.TTMD_SMOKE === "toolbar" ||
    process.env.TTMD_SMOKE === "autoopen" ||
    process.env.TTMD_SMOKE === "closequit" ||
    process.env.TTMD_SMOKE === "lock" ||
    process.env.TTMD_SMOKE === "lockback" ||
    process.env.TTMD_SMOKE === "idlelock" ||
    process.env.TTMD_SMOKE === "toolbarfixed" ||
    process.env.TTMD_SMOKE === "refocus" ||
    process.env.TTMD_SMOKE === "credentials" ||
    process.env.TTMD_SMOKE === "capture" ||
    process.env.TTMD_SMOKE === "clipboardlock"
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
  const toolbarSmoke = process.env.TTMD_SMOKE === "toolbar";
  const autoOpenSmoke = process.env.TTMD_SMOKE === "autoopen";
  const closeQuitSmoke = process.env.TTMD_SMOKE === "closequit";
  const lockSmoke = process.env.TTMD_SMOKE === "lock";
  const lockBackSmoke = process.env.TTMD_SMOKE === "lockback";
  const idleLockSmoke = process.env.TTMD_SMOKE === "idlelock";
  const toolbarFixedSmoke = process.env.TTMD_SMOKE === "toolbarfixed";
  const refocusSmoke = process.env.TTMD_SMOKE === "refocus";
  const credentialsSmoke = process.env.TTMD_SMOKE === "credentials";
  const captureSmoke = process.env.TTMD_SMOKE === "capture";
  const clipboardLockSmoke = process.env.TTMD_SMOKE === "clipboardlock";
  const deadline =
    Date.now() +
    (full ||
    settings ||
    setupSmoke ||
    toolbarSmoke ||
    autoOpenSmoke ||
    closeQuitSmoke ||
    lockSmoke ||
    lockBackSmoke ||
    idleLockSmoke ||
    toolbarFixedSmoke ||
    refocusSmoke ||
    credentialsSmoke ||
    captureSmoke ||
    clipboardLockSmoke
      ? 60_000
      : 12_000);
  let submitted = false;
  let dashboardTried = false;
  let dashboardClosed = false;

  if (autoOpenSmoke) {
    await runAutoOpenSmoke(window);
    return;
  }

  if (closeQuitSmoke) {
    await runCloseQuitSmoke(window);
    return;
  }

  if (lockSmoke) {
    await runLockSmoke(window);
    return;
  }

  if (lockBackSmoke) {
    await runLockBackSmoke(window);
    return;
  }

  if (idleLockSmoke) {
    await runIdleLockSmoke(window);
    return;
  }

  if (toolbarFixedSmoke) {
    await runToolbarFixedSmoke(window);
    return;
  }

  if (refocusSmoke) {
    await runRefocusSmoke(window);
    return;
  }

  if (credentialsSmoke) {
    await runCredentialsSmoke(window);
    return;
  }

  if (captureSmoke) {
    await runCaptureSmoke(window);
    return;
  }

  if (clipboardLockSmoke) {
    await runClipboardLockSmoke(window);
    return;
  }

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

      if (toolbarSmoke) {
        if (state.screen === "main") {
          await runToolbarSmoke(window);
          return;
        }
        if (state.screen === "error" || state.screen === "lock" || state.screen === "setup") {
          console.error(`[smoke] toolbar needs a seeded, unlocked vault, got screen=${state.screen}`);
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

          if (full) {
            const reachable = await waitForReachability(window, 10_000);
            console.log(`[smoke] reachability checked=${reachable}`);
            if (!reachable) {
              process.exitCode = 1;
            }
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
            const topLevelBefore = dashboardView.webContents.getURL();
            await dashboardView.webContents.executeJavaScript(
              'location.href = "https://example.com/"',
              true,
            );
            await delay(500);
            const topLevelAfter = dashboardView.webContents.getURL();
            const topLevelBlocked = topLevelAfter === topLevelBefore;
            console.log(`[smoke] top-level external blocked=${topLevelBlocked}`);
            if (!topLevelBlocked) {
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

async function runAutoOpenSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] autoopen start");
    let unlocked = false;
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      if (dashboardWindow) {
        if (!(await waitForDashboardLoad(30_000))) {
          throw new Error("the auto-opened dashboard did not finish loading");
        }
        console.log("[smoke] autoopen dashboard opened");
        app.quit();
        return;
      }

      const screen = (await window.webContents.executeJavaScript(
        'document.body.dataset.screen || ""',
      )) as string;

      if (screen === "lock" && !unlocked) {
        await window.webContents.executeJavaScript(
          `(() => {
            const node = document.getElementById("lock-password");
            if (node) node.value = "smoke-pass";
            document.getElementById("lock-form")?.requestSubmit();
          })()`,
          true,
        );
        unlocked = true;
      } else if (screen === "error") {
        throw new Error("auto-open reached the error screen");
      }

      await delay(100);
    }

    throw new Error("auto-open did not open a dashboard");
  } catch (error) {
    console.error(`[smoke] autoopen failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function runCloseQuitSmoke(window: BrowserWindow): Promise<void> {
  try {
    if (!(await waitForScreen(window, "main", 5000))) {
      throw new Error("the dashboard list did not load");
    }
    if (!(await waitForProfileButton(window, 3000))) {
      throw new Error("the profile card did not render");
    }
    await window.webContents.executeJavaScript(
      'document.querySelector(".profile-actions button")?.click()',
      true,
    );
    if (!(await waitForDashboard(5000))) {
      throw new Error("the dashboard window did not open");
    }
    if (!(await waitForDashboardLoad(30_000))) {
      throw new Error("the dashboard did not finish loading");
    }

    console.log("[smoke] closequit closing dashboard");
    dashboardWindow?.close();
    await delay(2000);
    throw new Error("closing the dashboard did not quit the app");
  } catch (error) {
    console.error(`[smoke] closequit failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function runLockSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] lock start");

    let unlocked = false;
    const loginDeadline = Date.now() + 15_000;
    while (Date.now() < loginDeadline) {
      const screen = (await window.webContents.executeJavaScript(
        'document.body.dataset.screen || ""',
      )) as string;
      if (screen === "main") {
        break;
      }
      if (screen === "lock" && !unlocked) {
        await window.webContents.executeJavaScript(
          `(() => {
            const node = document.getElementById("lock-password");
            if (node) node.value = "smoke-pass";
            document.getElementById("lock-form")?.requestSubmit();
          })()`,
          true,
        );
        unlocked = true;
      }
      await delay(100);
    }

    if (!(await waitForProfileButton(window, 3000))) {
      throw new Error("the profile card did not render");
    }
    await window.webContents.executeJavaScript(
      'document.querySelector(".profile-actions button")?.click()',
      true,
    );
    if (!(await waitForDashboard(5000))) {
      throw new Error("the dashboard window did not open");
    }
    if (!(await waitForDashboardLoad(30_000))) {
      throw new Error("the dashboard did not finish loading");
    }

    const lockVisible = (await dashboardToolbar?.webContents.executeJavaScript(
      '(() => { const node = document.getElementById("lock"); return !!node && !node.hidden; })()',
    )) as boolean;
    console.log(`[smoke] toolbar lock visible=${lockVisible}`);
    if (!lockVisible) {
      throw new Error("the toolbar lock button is hidden");
    }

    await dashboardToolbar?.webContents.executeJavaScript(
      'document.getElementById("lock")?.click()',
      true,
    );
    if (!(await waitForLockView(true, 5000))) {
      throw new Error("the lock overlay did not open");
    }
    const backdrop = await waitForBackdrop(3000);
    console.log(`[smoke] lock backdrop=${backdrop}`);
    if (!backdrop) {
      throw new Error("the dashboard snapshot did not reach the lock overlay");
    }
    console.log("[smoke] dashboard locked");

    await dashboardLock?.webContents.executeJavaScript(
      `(() => {
        const node = document.getElementById("lock-password");
        if (node) node.value = "smoke-pass";
        document.getElementById("lock-form")?.requestSubmit();
      })()`,
      true,
    );
    if (!(await waitForLockView(false, 15_000))) {
      throw new Error("the lock overlay did not unlock");
    }
    await delay(500);
    if (!(await waitForDashboardLoad(30_000))) {
      throw new Error("the dashboard did not reload after unlock");
    }
    console.log("[smoke] dashboard unlocked");

    app.quit();
  } catch (error) {
    console.error(`[smoke] lock failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function runLockBackSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] lockback start");
    let unlocked = false;
    const start = Date.now();

    while (Date.now() - start < 20_000 && !dashboardWindow) {
      const screen = (await window.webContents.executeJavaScript(
        'document.body.dataset.screen || ""',
      )) as string;

      if (screen === "lock" && !unlocked) {
        await window.webContents.executeJavaScript(
          `(() => {
            const node = document.getElementById("lock-password");
            if (node) node.value = "smoke-pass";
            document.getElementById("lock-form")?.requestSubmit();
          })()`,
          true,
        );
        unlocked = true;
      } else if (screen === "error") {
        throw new Error("lockback reached the error screen");
      }

      await delay(100);
    }

    if (!(await waitForDashboard(5000)) || !(await waitForDashboardLoad(30_000))) {
      throw new Error("the auto-opened dashboard did not open");
    }

    await dashboardToolbar?.webContents.executeJavaScript(
      'document.getElementById("lock")?.click()',
      true,
    );
    if (!(await waitForLockView(true, 5000))) {
      throw new Error("the dashboard lock overlay did not open");
    }

    await dashboardLock?.webContents.executeJavaScript(
      'document.getElementById("lock-back")?.click()',
      true,
    );
    if (!(await waitForDashboardClosed(5000))) {
      throw new Error("Back to dashboards did not close the dashboard");
    }
    if (!(await waitForScreen(window, "lock", 5000))) {
      throw new Error("the main lock screen did not appear");
    }
    console.log("[smoke] lockback at main lock screen");

    await window.webContents.executeJavaScript(
      `(() => {
        const node = document.getElementById("lock-password");
        if (node) node.value = "smoke-pass";
        document.getElementById("lock-form")?.requestSubmit();
      })()`,
      true,
    );
    if (!(await waitForScreen(window, "main", 8000))) {
      throw new Error("the main unlock did not complete");
    }
    await delay(1500);
    if (dashboardWindow) {
      throw new Error("unlocking returned to the dashboard after Back");
    }
    console.log("[smoke] lockback stayed on main menu");

    app.quit();
  } catch (error) {
    console.error(`[smoke] lockback failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function waitForBackdrop(timeoutMs: number): Promise<boolean> {
  return waitForCondition(async () => {
    const value = (await dashboardLock?.webContents.executeJavaScript(
      'document.body.dataset.backdrop || ""',
    )) as string;
    return value === "snapshot";
  }, timeoutMs);
}

async function runIdleLockSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] idlelock start");
    const start = Date.now();
    let unlocked = false;
    let sawMain = false;

    while (Date.now() - start < 30_000) {
      const screen = (await window.webContents.executeJavaScript(
        'document.body.dataset.screen || ""',
      )) as string;

      if (screen === "lock" && !unlocked) {
        await window.webContents.executeJavaScript(
          `(() => {
            const node = document.getElementById("lock-password");
            if (node) node.value = "smoke-pass";
            document.getElementById("lock-form")?.requestSubmit();
          })()`,
          true,
        );
        unlocked = true;
      } else if (screen === "main") {
        if (!sawMain) {
          sawMain = true;
          console.log("[smoke] idlelock unlocked");
        }
      } else if (screen === "lock" && unlocked && sawMain) {
        console.log("[smoke] idlelock locked");
        app.quit();
        return;
      }

      await delay(200);
    }

    throw new Error("idle lock did not trigger");
  } catch (error) {
    console.error(`[smoke] idlelock failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function runToolbarFixedSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] toolbarfixed start");
    if (!(await waitForScreen(window, "main", 5000))) {
      throw new Error("the dashboard list did not load");
    }
    if (!(await waitForProfileButton(window, 3000))) {
      throw new Error("the profile card did not render");
    }
    await window.webContents.executeJavaScript(
      'document.querySelector(".profile-actions button")?.click()',
      true,
    );
    if (!(await waitForDashboard(5000)) || !(await waitForDashboardLoad(30_000))) {
      throw new Error("the dashboard did not open");
    }

    await delay(2000);
    const expanded = (dashboardToolbar?.getBounds().height ?? 0) === toolbarHeight;
    const viewY = dashboardView?.getBounds().y;
    console.log(`[smoke] toolbarfixed expanded=${expanded} viewY=${viewY}`);
    if (!expanded || viewY !== toolbarHeight) {
      throw new Error("the fixed toolbar did not stay expanded");
    }

    app.quit();
  } catch (error) {
    console.error(`[smoke] toolbarfixed failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function runRefocusSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] refocus start");
    if (!(await waitForScreen(window, "main", 5000))) {
      throw new Error("the dashboard list did not load");
    }
    if (!(await waitForProfileButton(window, 3000))) {
      throw new Error("the profile card did not render");
    }
    await window.webContents.executeJavaScript(
      'document.querySelector(".profile-actions button")?.click()',
      true,
    );
    if (!(await waitForDashboard(5000)) || !(await waitForDashboardLoad(30_000))) {
      throw new Error("the dashboard did not open");
    }

    setToolbarExpanded(false);
    await delay(200);
    dashboardWindow?.blur();
    await delay(300);
    dashboardWindow?.focus();
    await delay(500);

    const expanded = (dashboardToolbar?.getBounds().height ?? 0) === toolbarHeight;
    const viewY = dashboardView?.getBounds().y;
    console.log(`[smoke] refocus expanded=${expanded} viewY=${viewY}`);
    if (!expanded || viewY !== 0) {
      throw new Error("the toolbar did not return on refocus");
    }

    app.quit();
  } catch (error) {
    console.error(`[smoke] refocus failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function runCredentialsSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] credentials start");
    if (!(await waitForScreen(window, "main", 5000))) {
      throw new Error("the dashboard list did not load");
    }
    if (!(await waitForProfileButton(window, 3000))) {
      throw new Error("the profile card did not render");
    }
    if (!control) {
      throw new Error("the core is not ready");
    }

    const profileID = (await control.status()).active_profile ?? "";
    if (!profileID) {
      throw new Error("no active profile");
    }

    await window.webContents.executeJavaScript(
      'document.querySelector(".profile-edit")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "profile", 3000))) {
      throw new Error("the profile editor did not open");
    }
    if (
      !(await waitForCondition(async () => {
        const count = (await window.webContents.executeJavaScript(
          'document.querySelectorAll(".credential-row").length',
        )) as number;
        return count === 2;
      }, 3000))
    ) {
      throw new Error("the seeded passwords did not appear in the editor");
    }
    console.log("[smoke] credentials seeded=2");

    await window.webContents.executeJavaScript(
      `(() => {
        document.getElementById("credential-add")?.click();
        const set = (id, value) => {
          const node = document.getElementById(id);
          if (node) node.value = value;
        };
        set("credential-name", "Grafana");
        set("credential-url", "http://192.168.0.4:3001");
        set("credential-username", "monitor");
        set("credential-password", "grafana-secret");
        document.getElementById("credential-form")?.requestSubmit();
      })()`,
      true,
    );
    if (
      !(await waitForCondition(async () => {
        const names = (await window.webContents.executeJavaScript(
          '[...document.querySelectorAll(".credential-row strong")].map((node) => node.textContent)',
        )) as string[];
        return Array.isArray(names) && names.includes("Grafana");
      }, 5000))
    ) {
      throw new Error("adding a password did not update the list");
    }
    let list = await control.listCredentials(profileID);
    const added = list.find((credential) => credential.name === "Grafana");
    if (!added) {
      throw new Error("the added password is not in the vault");
    }
    let secret = await control.credentialSecret(profileID, added.id);
    if (secret.username !== "monitor" || secret.password !== "grafana-secret") {
      throw new Error("the added password was stored incorrectly");
    }
    console.log("[smoke] credentials added");

    await window.webContents.executeJavaScript(
      `(() => {
        const rows = [...document.querySelectorAll(".credential-row")];
        const row = rows.find(
          (item) => item.querySelector("strong")?.textContent === "Grafana",
        );
        row?.querySelector("button")?.click();
        const set = (id, value) => {
          const node = document.getElementById(id);
          if (node) node.value = value;
        };
        set("credential-name", "Grafana 2");
        set("credential-username", "monitor2");
        set("credential-password", "");
        document.getElementById("credential-form")?.requestSubmit();
      })()`,
      true,
    );
    if (
      !(await waitForCondition(async () => {
        const names = (await window.webContents.executeJavaScript(
          '[...document.querySelectorAll(".credential-row strong")].map((node) => node.textContent)',
        )) as string[];
        return Array.isArray(names) && names.includes("Grafana 2");
      }, 5000))
    ) {
      throw new Error("editing a password did not update the list");
    }
    list = await control.listCredentials(profileID);
    const edited = list.find((credential) => credential.name === "Grafana 2");
    if (!edited || edited.username !== "monitor2") {
      throw new Error("the edited password was not saved");
    }
    secret = await control.credentialSecret(profileID, edited.id);
    if (secret.password !== "grafana-secret") {
      throw new Error("a blank edit replaced the stored password");
    }
    console.log("[smoke] credentials edited");

    await window.webContents.executeJavaScript(
      `(() => {
        window.confirm = () => true;
        const rows = [...document.querySelectorAll(".credential-row")];
        const row = rows.find(
          (item) => item.querySelector("strong")?.textContent === "Grafana 2",
        );
        row?.querySelectorAll("button")[1]?.click();
      })()`,
      true,
    );
    if (
      !(await waitForCondition(async () => {
        const names = (await window.webContents.executeJavaScript(
          '[...document.querySelectorAll(".credential-row strong")].map((node) => node.textContent)',
        )) as string[];
        return Array.isArray(names) && !names.includes("Grafana 2");
      }, 5000))
    ) {
      throw new Error("deleting a password did not update the list");
    }
    console.log("[smoke] credentials deleted");

    await window.webContents.executeJavaScript(
      'document.getElementById("profile-back")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "main", 3000))) {
      throw new Error("could not return to the dashboard list");
    }
    await window.webContents.executeJavaScript(
      'document.querySelector(".profile-actions button")?.click()',
      true,
    );
    if (!(await waitForDashboard(5000)) || !(await waitForDashboardLoad(30_000))) {
      throw new Error("the dashboard did not open");
    }
    const toolbar = dashboardToolbar;
    if (!toolbar) {
      throw new Error("the toolbar did not open");
    }

    if (
      !(await waitForCondition(async () => {
        const hidden = (await toolbar.webContents.executeJavaScript(
          'document.getElementById("passwords")?.hidden',
        )) as boolean;
        return hidden === false;
      }, 5000))
    ) {
      throw new Error("the toolbar did not receive the saved passwords");
    }
    const leaked = (await toolbar.webContents.executeJavaScript(
      'document.body.innerText.includes("hunter2") || document.body.innerText.includes("grafana-secret") || document.body.innerText.includes("opencode-secret")',
    )) as boolean;
    if (leaked) {
      throw new Error("the toolbar DOM contains a stored password");
    }
    console.log("[smoke] credentials toolbar ready");

    await toolbar.webContents.executeJavaScript(
      'document.getElementById("passwords")?.click()',
      true,
    );
    if (
      !(await waitForCondition(async () => {
        const open = (await toolbar.webContents.executeJavaScript(
          'document.getElementById("passwords-panel")?.classList.contains("open")',
        )) as boolean;
        return open === true;
      }, 3000))
    ) {
      throw new Error("the passwords panel did not open");
    }
    const rows = (await toolbar.webContents.executeJavaScript(
      'document.querySelectorAll(".credential").length',
    )) as number;
    if (rows !== 2) {
      throw new Error(`the passwords panel shows ${rows} rows, want 2`);
    }
    const fillable = (await toolbar.webContents.executeJavaScript(
      '!!document.querySelector(".credential-fill")',
    )) as boolean;
    if (fillable) {
      throw new Error("a login for another origin showed a fill button");
    }
    const view = dashboardView;
    if (!view) {
      throw new Error("the dashboard view is missing");
    }
    await view.webContents.executeJavaScript(
      `(() => {
        document.getElementById("__ttmd_guard_form")?.remove();
        const form = document.createElement("form");
        form.id = "__ttmd_guard_form";
        const pass = document.createElement("input");
        pass.type = "password";
        pass.name = "password";
        form.append(pass);
        document.body.append(form);
        pass.focus();
      })()`,
      true,
    );
    await delay(700);
    const pillVisible = (await view.webContents.executeJavaScript(
      'document.getElementById("__ttmd_fill_host")?.style.display || ""',
    )) as string;
    if (pillVisible === "block") {
      throw new Error("the inline fill pill appeared without a matching login");
    }
    console.log("[smoke] credentials panel=2 fill-guard=ok inline-guard=ok");

    await toolbar.webContents.executeJavaScript(
      `(() => {
        const rows = [...document.querySelectorAll(".credential")];
        const row = rows.find(
          (item) => item.querySelector("strong")?.textContent === "Jellyfin",
        );
        const button = [...(row?.querySelectorAll("button") ?? [])].find(
          (item) => item.textContent === "Password",
        );
        button?.click();
      })()`,
      true,
    );
    if (
      !(await waitForCondition(async () => (await clipboard.readText()) === "hunter2", 3000))
    ) {
      throw new Error("copying the password did not reach the clipboard");
    }
    console.log("[smoke] credentials copied");
    if (
      !(await waitForCondition(async () => (await clipboard.readText()) === "", 4000))
    ) {
      throw new Error("the clipboard was not cleared after the timeout");
    }
    console.log("[smoke] credentials clipboard cleared");

    const after = (await toolbar.webContents.executeJavaScript(
      'document.body.innerText.includes("hunter2")',
    )) as boolean;
    if (after) {
      throw new Error("the copied password appeared in the toolbar DOM");
    }
    console.log("[smoke] credentials toolbar clean");

    app.quit();
  } catch (error) {
    console.error(`[smoke] credentials failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function runCaptureSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] capture start");
    if (!(await waitForScreen(window, "main", 5000))) {
      throw new Error("the dashboard list did not load");
    }
    if (!(await waitForProfileButton(window, 3000))) {
      throw new Error("the profile card did not render");
    }
    if (!control) {
      throw new Error("the core is not ready");
    }
    const client = control;
    const profileID = (await client.status()).active_profile ?? "";
    if (!profileID) {
      throw new Error("no active profile");
    }

    await window.webContents.executeJavaScript(
      'document.querySelector(".profile-actions button")?.click()',
      true,
    );
    if (!(await waitForDashboard(5000)) || !(await waitForDashboardLoad(30_000))) {
      throw new Error("the dashboard did not open");
    }
    const toolbar = dashboardToolbar;
    const view = dashboardView;
    if (!toolbar || !view) {
      throw new Error("the dashboard views did not open");
    }

    if (
      !(await waitForCondition(async () => {
        const hidden = (await toolbar.webContents.executeJavaScript(
          'document.getElementById("passwords")?.hidden',
        )) as boolean;
        return hidden === false;
      }, 5000))
    ) {
      throw new Error("the passwords button did not appear");
    }

    await toolbar.webContents.executeJavaScript(
      'document.getElementById("passwords")?.click()',
      true,
    );
    const warned = (await toolbar.webContents.executeJavaScript(
      'document.getElementById("passwords")?.classList.contains("warn")',
    )) as boolean;
    if (!warned) {
      throw new Error("the empty passwords button did not flash");
    }
    if (
      !(await waitForCondition(async () => {
        const open = (await toolbar.webContents.executeJavaScript(
          'document.getElementById("passwords-toast")?.classList.contains("open")',
        )) as boolean;
        return open === true;
      }, 3000))
    ) {
      throw new Error("the empty passwords toast did not open");
    }
    const toastText = (await toolbar.webContents.executeJavaScript(
      'document.getElementById("passwords-toast")?.textContent || ""',
    )) as string;
    if (!toastText.includes("No stored passwords")) {
      throw new Error(`the empty toast read: ${toastText}`);
    }
    console.log("[smoke] capture empty toast");

    if (
      !(await waitForCondition(async () => {
        const open = (await toolbar.webContents.executeJavaScript(
          'document.getElementById("passwords-toast")?.classList.contains("open")',
        )) as boolean;
        return open === false;
      }, 5000))
    ) {
      throw new Error("the empty passwords toast did not close");
    }

    const injectLogin = async (password: string): Promise<void> => {
      await view.webContents.executeJavaScript(
        `(() => {
          document.getElementById("__ttmd_test_form")?.remove();
          const form = document.createElement("form");
          form.id = "__ttmd_test_form";
          form.addEventListener("submit", (event) => event.preventDefault());
          const user = document.createElement("input");
          user.name = "username";
          user.autocomplete = "username";
          user.value = "alex";
          const pass = document.createElement("input");
          pass.type = "password";
          pass.name = "password";
          pass.value = ${JSON.stringify(password)};
          form.append(user, pass);
          document.body.append(form);
          pass.focus();
        })()`,
        true,
      );
    };

    const submitLogin = async (password: string, path: string): Promise<void> => {
      await injectLogin(password);
      view.webContents.focus();
      view.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      view.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      await delay(150);
      await view.webContents
        .loadURL(new URL(path, dashboardHomeURL).toString())
        .catch(() => undefined);
    };

    await submitLogin("hunter2", "/capture-success-1");
    if (
      !(await waitForCondition(async () => {
        const list = await client.listCredentials(profileID);
        return list.length === 1;
      }, 5000))
    ) {
      throw new Error("the login was not captured");
    }
    let list = await client.listCredentials(profileID);
    const saved = list[0];
    const expectedOrigin = new URL(dashboardHomeURL).origin;
    if (saved.url !== expectedOrigin || saved.username !== "alex" || !saved.name) {
      throw new Error(`captured credential = ${JSON.stringify(saved)}`);
    }
    let secret = await client.credentialSecret(profileID, saved.id);
    if (secret.password !== "hunter2") {
      throw new Error("the captured password was stored incorrectly");
    }
    console.log("[smoke] capture saved");

    if (
      !(await waitForCondition(async () => {
        const count = (await toolbar.webContents.executeJavaScript(
          'document.getElementById("passwords-count")?.textContent || ""',
        )) as string;
        return count.includes("1 saved");
      }, 3000))
    ) {
      throw new Error("the toolbar did not receive the saved login");
    }

    await delay(1700);
    await submitLogin("hunter2", "/capture-success-2");
    await delay(800);
    list = await client.listCredentials(profileID);
    if (list.length !== 1) {
      throw new Error("the same login was saved twice");
    }

    await submitLogin("new-secret", "/capture-success-3");
    if (
      !(await waitForCondition(async () => {
        const current = await client.listCredentials(profileID);
        if (current.length !== 1) {
          return false;
        }
        const currentSecret = await client.credentialSecret(
          profileID,
          current[0].id,
        );
        return currentSecret.password === "new-secret";
      }, 5000))
    ) {
      throw new Error("the updated password was not saved");
    }
    list = await client.listCredentials(profileID);
    if (list.length !== 1) {
      throw new Error("the update created a second login");
    }
    secret = await client.credentialSecret(profileID, list[0].id);
    if (secret.password !== "new-secret") {
      throw new Error("the updated password was stored incorrectly");
    }
    console.log("[smoke] capture updated");

    await injectLogin("synthetic-secret");
    await view.webContents.executeJavaScript(
      'document.getElementById("__ttmd_test_form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))',
      true,
    );
    await delay(150);
    await view.webContents
      .loadURL(new URL("/capture-synthetic", dashboardHomeURL).toString())
      .catch(() => undefined);
    await delay(800);
    list = await client.listCredentials(profileID);
    if (list.length !== 1) {
      throw new Error("a synthetic submit saved a login");
    }
    secret = await client.credentialSecret(profileID, list[0].id);
    if (secret.password !== "new-secret") {
      throw new Error("a synthetic submit replaced the saved password");
    }
    console.log("[smoke] capture synthetic ignored");

    await view.webContents.executeJavaScript(
      `(() => {
        document.getElementById("__ttmd_fill_form")?.remove();
        const form = document.createElement("form");
        form.id = "__ttmd_fill_form";
        const user = document.createElement("input");
        user.name = "username";
        user.autocomplete = "username";
        const pass = document.createElement("input");
        pass.type = "password";
        pass.name = "password";
        form.append(user, pass);
        document.body.append(form);
      })()`,
      true,
    );

    await toolbar.webContents.executeJavaScript(
      'document.getElementById("passwords")?.click()',
      true,
    );
    if (
      !(await waitForCondition(async () => {
        const open = (await toolbar.webContents.executeJavaScript(
          'document.getElementById("passwords-panel")?.classList.contains("open")',
        )) as boolean;
        return open === true;
      }, 3000))
    ) {
      throw new Error("the passwords panel did not open for fill");
    }
    const canFill = (await toolbar.webContents.executeJavaScript(
      '!!document.querySelector(".credential-fill")',
    )) as boolean;
    if (!canFill) {
      throw new Error("the matching login has no fill button");
    }
    await toolbar.webContents.executeJavaScript(
      'document.querySelector(".credential-fill")?.click()',
      true,
    );
    if (
      !(await waitForCondition(async () => {
        const values = (await view.webContents.executeJavaScript(`({
          username: document.querySelector("#__ttmd_fill_form input[name=username]")?.value || "",
          password: document.querySelector("#__ttmd_fill_form input[type=password]")?.value || "",
        })`)) as { username: string; password: string };
        return values.username === "alex" && values.password === "new-secret";
      }, 5000))
    ) {
      throw new Error("the login was not filled");
    }
    console.log("[smoke] capture filled");

    const leaked = (await toolbar.webContents.executeJavaScript(
      'document.body.innerText.includes("hunter2") || document.body.innerText.includes("new-secret")',
    )) as boolean;
    if (leaked) {
      throw new Error("a password appeared in the toolbar DOM");
    }
    console.log("[smoke] capture toolbar clean");

    await view.webContents.executeJavaScript(
      `(() => {
        const form = document.getElementById("__ttmd_fill_form");
        const user = form?.querySelector('input[name="username"]');
        const pass = form?.querySelector('input[type="password"]');
        if (user) user.value = "";
        if (pass) {
          pass.value = "";
          pass.focus();
        }
      })()`,
      true,
    );
    if (
      !(await waitForCondition(async () => {
        const display = (await view.webContents.executeJavaScript(
          'document.getElementById("__ttmd_fill_host")?.style.display || ""',
        )) as string;
        return display === "block";
      }, 3000))
    ) {
      throw new Error("the inline fill pill did not appear");
    }
    const pill = (await view.webContents.executeJavaScript(
      `(() => {
        const host = document.getElementById("__ttmd_fill_host");
        if (!host) return null;
        const rect = host.getBoundingClientRect();
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      })()`,
    )) as { x: number; y: number } | null;
    if (!pill) {
      throw new Error("the inline fill pill has no position");
    }
    view.webContents.sendInputEvent({
      type: "mouseDown",
      x: pill.x,
      y: pill.y,
      button: "left",
      clickCount: 1,
    });
    view.webContents.sendInputEvent({
      type: "mouseUp",
      x: pill.x,
      y: pill.y,
      button: "left",
      clickCount: 1,
    });
    if (
      !(await waitForCondition(async () => {
        const values = (await view.webContents.executeJavaScript(`({
          username: document.querySelector("#__ttmd_fill_form input[name=username]")?.value || "",
          password: document.querySelector("#__ttmd_fill_form input[type=password]")?.value || "",
        })`)) as { username: string; password: string };
        return values.username === "alex" && values.password === "new-secret";
      }, 5000))
    ) {
      throw new Error("the inline fill did not work");
    }
    console.log("[smoke] capture inline filled");

    await toolbar.webContents.executeJavaScript(
      'document.querySelector(".credential-delete")?.click()',
      true,
    );
    await delay(150);
    await toolbar.webContents.executeJavaScript(
      'document.querySelector(".credential-delete")?.click()',
      true,
    );
    if (
      !(await waitForCondition(async () => {
        const list = await client.listCredentials(profileID);
        return list.length === 0;
      }, 5000))
    ) {
      throw new Error("the toolbar delete did not remove the login");
    }
    console.log("[smoke] capture toolbar deleted");

    app.quit();
  } catch (error) {
    console.error(`[smoke] capture failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function runClipboardLockSmoke(window: BrowserWindow): Promise<void> {
  try {
    console.log("[smoke] clipboardlock start");
    let unlocked = false;
    const loginDeadline = Date.now() + 15_000;
    while (Date.now() < loginDeadline) {
      const screen = (await window.webContents.executeJavaScript(
        'document.body.dataset.screen || ""',
      )) as string;
      if (screen === "main") {
        break;
      }
      if (screen === "lock" && !unlocked) {
        await window.webContents.executeJavaScript(
          `(() => {
            const node = document.getElementById("lock-password");
            if (node) node.value = "smoke-pass";
            document.getElementById("lock-form")?.requestSubmit();
          })()`,
          true,
        );
        unlocked = true;
      }
      await delay(100);
    }

    if (!(await waitForProfileButton(window, 3000))) {
      throw new Error("the profile card did not render");
    }
    await window.webContents.executeJavaScript(
      'document.querySelector(".profile-actions button")?.click()',
      true,
    );
    if (!(await waitForDashboard(5000)) || !(await waitForDashboardLoad(30_000))) {
      throw new Error("the dashboard did not open");
    }
    const toolbar = dashboardToolbar;
    if (!toolbar) {
      throw new Error("the toolbar did not open");
    }

    if (
      !(await waitForCondition(async () => {
        const hidden = (await toolbar.webContents.executeJavaScript(
          'document.getElementById("passwords")?.hidden',
        )) as boolean;
        return hidden === false;
      }, 5000))
    ) {
      throw new Error("the passwords button did not appear");
    }

    await toolbar.webContents.executeJavaScript(
      'document.getElementById("passwords")?.click()',
      true,
    );
    if (
      !(await waitForCondition(async () => {
        const open = (await toolbar.webContents.executeJavaScript(
          'document.getElementById("passwords-panel")?.classList.contains("open")',
        )) as boolean;
        return open === true;
      }, 3000))
    ) {
      throw new Error("the passwords panel did not open");
    }
    await toolbar.webContents.executeJavaScript(
      `(() => {
        const rows = [...document.querySelectorAll(".credential")];
        const row = rows.find(
          (item) => item.querySelector("strong")?.textContent === "Jellyfin",
        );
        const button = [...(row?.querySelectorAll("button") ?? [])].find(
          (item) => item.textContent === "Password",
        );
        button?.click();
      })()`,
      true,
    );
    if (
      !(await waitForCondition(async () => (await clipboard.readText()) === "hunter2", 3000))
    ) {
      throw new Error("the password did not reach the clipboard");
    }
    console.log("[smoke] clipboardlock copied");

    await toolbar.webContents.executeJavaScript(
      'document.getElementById("app")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "main", 5000))) {
      throw new Error("the main menu did not return");
    }
    await window.webContents.executeJavaScript(
      'document.getElementById("lock-button")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "lock", 5000))) {
      throw new Error("the main lock screen did not open");
    }
    if ((await clipboard.readText()) !== "") {
      throw new Error("the clipboard survived the main-window lock");
    }
    console.log("[smoke] clipboardlock cleared");

    app.quit();
  } catch (error) {
    console.error(`[smoke] clipboardlock failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function waitForLockView(visible: boolean, timeoutMs: number): Promise<boolean> {
  return waitForCondition(async () => dashboardLock?.getVisible() === visible, timeoutMs);
}

async function runToolbarSmoke(window: BrowserWindow): Promise<void> {
  try {
    await window.webContents.executeJavaScript(
      'document.querySelector(".profile-actions button")?.click()',
      true,
    );
    if (!(await waitForDashboard(5000))) {
      throw new Error("the dashboard window did not open");
    }
    if (!(await waitForDashboardLoad(30_000))) {
      throw new Error("the dashboard did not finish loading");
    }

    console.log("[smoke] toolbar watching");
    console.log(
      `[smoke] toolbar window=${JSON.stringify(dashboardWindow?.getContentBounds())}`,
    );
    const expectedViewY = 0;
    let last = (dashboardToolbar?.getBounds().height ?? 0) === toolbarHeight;
    console.log(`[smoke] toolbar expanded=${last}`);
    const initialViewY = dashboardView?.getBounds().y;
    console.log(`[smoke] toolbar view y=${initialViewY}`);
    if (initialViewY !== expectedViewY) {
      throw new Error("the auto-hide toolbar should overlay the dashboard");
    }
    let sawHidden = !last;
    let sawShownAgain = false;

    const end = Date.now() + 8000;
    while (Date.now() < end) {
      await delay(100);
      const current = (dashboardToolbar?.getBounds().height ?? 0) === toolbarHeight;
      if (current === last) {
        continue;
      }
      last = current;
      console.log(`[smoke] toolbar expanded=${current}`);
      const settled = await waitForCondition(
        async () =>
          (dashboardToolbar?.getBounds().height ?? 0) ===
          (current ? toolbarHeight : peekHeight),
        2000,
      );
      const settledHeight = dashboardToolbar?.getBounds().height;
      const viewY = dashboardView?.getBounds().y;
      if (!settled || viewY !== expectedViewY) {
        throw new Error(
          `the dashboard view does not overlay the toolbar: height=${settledHeight} viewY=${viewY} expanded=${current}`,
        );
      }
      if (!current) {
        sawHidden = true;
      } else if (sawHidden) {
        sawShownAgain = true;
      }
    }

    console.log(`[smoke] toolbar hidden=${sawHidden} revealed=${sawShownAgain}`);
    if (!sawHidden || !sawShownAgain) {
      throw new Error("the toolbar did not hide and reveal");
    }

    app.quit();
  } catch (error) {
    console.error(`[smoke] toolbar failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
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

    if (!(await waitForText(window, "setup-error", "Passwords do not match", 3000))) {
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
    if (summary.profiles !== 0) {
      throw new Error("profile editing is still in settings");
    }

    const openLastBefore = settingsStore.get().open_last_dashboard;
    await window.webContents.executeJavaScript(
      'document.getElementById("settings-open-last")?.click()',
      true,
    );
    if (
      !(await waitForCondition(
        async () => settingsStore.get().open_last_dashboard === !openLastBefore,
        3000,
      ))
    ) {
      throw new Error("open-last-dashboard setting was not saved");
    }
    await window.webContents.executeJavaScript(
      'document.getElementById("settings-open-last")?.click()',
      true,
    );
    if (
      !(await waitForCondition(
        async () => settingsStore.get().open_last_dashboard === openLastBefore,
        3000,
      ))
    ) {
      throw new Error("open-last-dashboard setting was not restored");
    }
    console.log("[smoke] settings open-last saved");

    const autoHideBefore = settingsStore.get().auto_hide_toolbar;
    await window.webContents.executeJavaScript(
      'document.getElementById("settings-auto-hide")?.click()',
      true,
    );
    if (
      !(await waitForCondition(
        async () => settingsStore.get().auto_hide_toolbar === !autoHideBefore,
        3000,
      ))
    ) {
      throw new Error("auto-hide setting was not saved");
    }
    await window.webContents.executeJavaScript(
      'document.getElementById("settings-auto-hide")?.click()',
      true,
    );
    if (
      !(await waitForCondition(
        async () => settingsStore.get().auto_hide_toolbar === autoHideBefore,
        3000,
      ))
    ) {
      throw new Error("auto-hide setting was not restored");
    }
    console.log("[smoke] settings auto-hide saved");

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
    if (!(await waitForText(window, "settings-password-error", "Passwords do not match", 3000))) {
      throw new Error("mismatched passwords were not rejected");
    }
    console.log("[smoke] settings confirm mismatch rejected");

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
      'document.getElementById("settings-force-lan")?.click()',
      true,
    );
    if (!(await waitForSecurity({ force: true }, 3000))) {
      throw new Error("force LAN-only was not saved");
    }
    await window.webContents.executeJavaScript(
      'document.getElementById("settings-idle-lock")?.click()',
      true,
    );
    if (!(await waitForSecurity({ idle: true }, 3000))) {
      throw new Error("idle lock was not saved");
    }
    await window.webContents.executeJavaScript(
      `(() => {
        const node = document.getElementById("settings-idle-minutes");
        if (node) {
          node.value = "30";
          node.dispatchEvent(new Event("change"));
        }
      })()`,
      true,
    );
    if (!(await waitForSecurity({ minutes: 30 }, 3000))) {
      throw new Error("idle minutes were not saved");
    }
    console.log("[smoke] settings security saved");

    await window.webContents.executeJavaScript(
      'document.getElementById("settings-back")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "main", 3000))) {
      throw new Error("could not return to the dashboard list");
    }
    if (!(await openProfileEditor(window))) {
      throw new Error("the profile editor did not open");
    }
    const overridden = (await window.webContents.executeJavaScript(
      '(() => { const node = document.getElementById("profile-external-origins"); return !!node && node.disabled; })()',
    )) as boolean;
    console.log(`[smoke] profile external disabled=${overridden}`);
    if (!overridden) {
      throw new Error("force LAN-only did not disable profile external content");
    }
    await window.webContents.executeJavaScript(
      'document.getElementById("profile-back")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "main", 3000))) {
      throw new Error("could not leave the profile editor");
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

    if (!(await waitForSecurity({ force: true, idle: true, minutes: 30 }, 3000))) {
      throw new Error("security settings did not persist");
    }
    await window.webContents.executeJavaScript(
      'document.getElementById("settings-force-lan")?.click()',
      true,
    );
    if (!(await waitForSecurity({ force: false }, 3000))) {
      throw new Error("force LAN-only was not turned off");
    }
    await window.webContents.executeJavaScript(
      'document.getElementById("settings-idle-lock")?.click()',
      true,
    );
    if (!(await waitForSecurity({ idle: false }, 3000))) {
      throw new Error("idle lock was not turned off");
    }
    console.log("[smoke] settings security reset");

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

    await window.webContents.executeJavaScript(
      'document.getElementById("settings-back")?.click()',
      true,
    );
    if (!(await waitForScreen(window, "main", 3000))) {
      throw new Error("could not return to the dashboard list");
    }

    const seeded = await control?.status();
    const originalName = seeded?.profiles[0]?.name;
    if (!originalName) {
      throw new Error("the seeded profile is missing");
    }

    if (!(await openProfileEditor(window))) {
      throw new Error("the profile editor did not open");
    }
    await window.webContents.executeJavaScript(
      `(() => {
        const input = document.getElementById("profile-name");
        if (input) input.value = "Home edited";
        document.getElementById("profile-save")?.click();
      })()`,
      true,
    );
    if (!(await waitForProfileName("Home edited", 5000))) {
      throw new Error("profile rename was not saved");
    }
    if (!(await waitForProfileSaveIdle(window, 3000))) {
      throw new Error("the profile save button stayed busy");
    }
    if (!(await waitForScreen(window, "main", 3000))) {
      throw new Error("the profile editor did not return to the dashboard list");
    }
    console.log("[smoke] profile rename saved");

    if (!(await openProfileEditor(window))) {
      throw new Error("the profile editor did not reopen");
    }
    await window.webContents.executeJavaScript(
      `(() => {
        const input = document.getElementById("profile-name");
        if (input) input.value = ${JSON.stringify(originalName)};
        document.getElementById("profile-save")?.click();
      })()`,
      true,
    );
    if (!(await waitForProfileName(originalName, 5000))) {
      throw new Error("profile rename was not restored");
    }
    if (!(await waitForProfileSaveIdle(window, 3000))) {
      throw new Error("the profile save button stayed busy after restoring the name");
    }

    if (!(await openProfileEditor(window))) {
      throw new Error("the profile editor did not reopen");
    }
    await window.webContents.executeJavaScript(
      `(() => {
        const node = document.getElementById("profile-external-all");
        if (node) {
          node.checked = true;
          node.dispatchEvent(new Event("change"));
        }
        document.getElementById("profile-save")?.click();
      })()`,
      true,
    );
    if (!(await waitForExternalState("all", null, 5000))) {
      throw new Error("allow-all external content was not saved");
    }
    if (!(await waitForProfileSaveIdle(window, 3000))) {
      throw new Error("the profile save button stayed busy after saving allow-all");
    }
    if (!(await waitForScreen(window, "main", 3000))) {
      throw new Error("the profile editor did not return after saving allow-all");
    }
    console.log("[smoke] profile external all saved");

    if (!(await openProfileEditor(window))) {
      throw new Error("the profile editor did not reopen");
    }
    await window.webContents.executeJavaScript(
      `(() => {
        const originsRadio = document.getElementById("profile-external-origins");
        if (originsRadio) {
          originsRadio.checked = true;
          originsRadio.dispatchEvent(new Event("change"));
        }
        const origins = document.getElementById("profile-origins");
        if (origins) {
          origins.value = ["https://fonts.googleapis.com", "https://cdn.jsdelivr.net"].join(String.fromCharCode(10));
        }
        document.getElementById("profile-save")?.click();
      })()`,
      true,
    );
    if (!(await waitForExternalState("origins", 2, 5000))) {
      throw new Error("specific external origins were not saved");
    }
    if (!(await waitForProfileSaveIdle(window, 3000))) {
      throw new Error("the profile save button stayed busy after saving origins");
    }
    if (!(await waitForScreen(window, "main", 3000))) {
      throw new Error("the profile editor did not return after saving origins");
    }
    console.log("[smoke] profile external origins saved");

    if (!(await openProfileEditor(window))) {
      throw new Error("the profile editor did not reopen");
    }
    await window.webContents.executeJavaScript(
      `(() => {
        const node = document.getElementById("profile-external-off");
        if (node) {
          node.checked = true;
          node.dispatchEvent(new Event("change"));
        }
        document.getElementById("profile-save")?.click();
      })()`,
      true,
    );
    if (!(await waitForExternalState("off", null, 5000))) {
      throw new Error("external content did not turn off");
    }
    if (!(await waitForProfileSaveIdle(window, 3000))) {
      throw new Error("the profile save button stayed busy after turning external off");
    }
    if (!(await waitForScreen(window, "main", 3000))) {
      throw new Error("the profile editor did not return after turning external off");
    }
    console.log("[smoke] profile external off");

    app.quit();
  } catch (error) {
    console.error(`[smoke] settings failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    app.quit();
  }
}

async function openProfileEditor(window: BrowserWindow): Promise<boolean> {
  await window.webContents.executeJavaScript(
    'document.querySelector(".profile-edit")?.click()',
    true,
  );
  return waitForScreen(window, "profile", 3000);
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
      '(() => { const button = document.getElementById("profile-save"); return !!button && !button.disabled; })()',
    )) as boolean;
    return idle;
  }, timeoutMs);
}

async function waitForSecurity(
  expected: { force?: boolean; idle?: boolean; minutes?: number },
  timeoutMs: number,
): Promise<boolean> {
  return waitForCondition(async () => {
    const state = await control?.status();
    const security = state?.security;
    if (!security) {
      return false;
    }
    if (expected.force !== undefined && security.force_lan_only !== expected.force) {
      return false;
    }
    if (expected.idle !== undefined && security.lock_after_idle !== expected.idle) {
      return false;
    }
    if (expected.minutes !== undefined && security.idle_minutes !== expected.minutes) {
      return false;
    }
    return true;
  }, timeoutMs);
}

async function waitForExternalState(
  mode: string,
  originCount: number | null,
  timeoutMs: number,
): Promise<boolean> {
  return waitForCondition(async () => {
    const state = await control?.status();
    const profile = state?.profiles[0];
    const modeMatches = profile?.external_mode === mode;
    const countMatches =
      originCount === null || (profile?.external_origins?.length ?? 0) === originCount;
    return modeMatches && countMatches;
  }, timeoutMs);
}

async function waitForProfileButton(
  window: BrowserWindow,
  timeoutMs: number,
): Promise<boolean> {
  return waitForCondition(async () => {
    const ready = (await window.webContents.executeJavaScript(
      '!!document.querySelector(".profile-actions button")',
    )) as boolean;
    return ready;
  }, timeoutMs);
}

async function waitForReachability(
  window: BrowserWindow,
  timeoutMs: number,
): Promise<boolean> {
  return waitForCondition(async () => {
    const reachable = (await window.webContents.executeJavaScript(
      '(() => { const dot = document.querySelector(".dot-button .status-dot"); return !!dot && dot.classList.contains("on"); })()',
    )) as boolean;
    return reachable;
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

  await settingsStore.load();
  await startCore();
  registerIpc({
    control,
    coreError,
    getWindow: () => mainWindow,
    navigation,
    settings: settingsStore,
    lockVault,
    unlockDashboard,
    openDashboard,
  });
  createWindow();
  startIdleMonitor();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (!quitting && (clipboardValue || clipboardPending > 0)) {
    quitting = true;
    event.preventDefault();
    void Promise.race([clearClipboardIfOurs(), delay(1000)]).finally(() => {
      app.quit();
    });
    return;
  }
  stopIdleMonitor();
  core?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
