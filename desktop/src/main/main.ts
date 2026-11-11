import { app, BrowserWindow, Menu, session } from "electron";
import path from "node:path";

app.setName("Tunnel to My Dash");

if (!app.isPackaged) {
  app.setPath("userData", path.resolve(app.getAppPath(), "..", "local", "dev-data", "electron"));
}

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

function createWindow(): void {
  const window = new BrowserWindow({
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

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
    }
  });
  window.loadFile(path.join(__dirname, "renderer/index.html"));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
