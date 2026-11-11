import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./shared/ipc";
import type {
  NavigationBridge,
  NavState,
  ToolbarCredentialsState,
  ToolbarPanelState,
} from "./shared/types";

const api: NavigationBridge = {
  back: () => ipcRenderer.invoke(IPC.navBack),
  forward: () => ipcRenderer.invoke(IPC.navForward),
  reload: () => ipcRenderer.invoke(IPC.navReload),
  home: () => ipcRenderer.invoke(IPC.navHome),
  backToApp: () => ipcRenderer.invoke(IPC.navBackToApp),
  lock: () => ipcRenderer.invoke(IPC.navLock),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: NavState) => callback(state);
    ipcRenderer.on(IPC.navState, listener);
    return () => {
      ipcRenderer.removeListener(IPC.navState, listener);
    };
  },
  onCredentials: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ToolbarCredentialsState) =>
      callback(state);
    ipcRenderer.on(IPC.toolbarCredentials, listener);
    return () => {
      ipcRenderer.removeListener(IPC.toolbarCredentials, listener);
    };
  },
  onPanelState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ToolbarPanelState) =>
      callback(state);
    ipcRenderer.on(IPC.toolbarPanelState, listener);
    return () => {
      ipcRenderer.removeListener(IPC.toolbarPanelState, listener);
    };
  },
  copyCredential: (credentialID, field) =>
    ipcRenderer.invoke(IPC.toolbarCopyCredential, credentialID, field),
  openPanel: (height) => ipcRenderer.invoke(IPC.toolbarPanel, { open: true, height }),
  closePanel: () => ipcRenderer.invoke(IPC.toolbarPanel, { open: false }),
};

contextBridge.exposeInMainWorld("ttmdNav", api);

window.addEventListener("mousemove", () => {
  ipcRenderer.send(IPC.pointerToolbar, { y: 0, out: false });
});

window.addEventListener("mouseenter", () => {
  ipcRenderer.send(IPC.pointerToolbar, { y: 0, out: false });
});

window.addEventListener("mouseleave", () => {
  ipcRenderer.send(IPC.pointerToolbar, { y: 0, out: true });
});

let lastHover = false;
setInterval(() => {
  const bar = document.querySelector(".bar");
  const over = !!bar && bar.matches(":hover");
  if (over === lastHover) {
    return;
  }
  lastHover = over;
  ipcRenderer.send(IPC.pointerToolbar, { y: 0, out: !over });
}, 120);
