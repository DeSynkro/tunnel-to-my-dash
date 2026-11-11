import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./shared/ipc";
import type { LockBridge } from "./shared/types";

const api: LockBridge = {
  unlock: (password) => ipcRenderer.invoke(IPC.dashboardUnlock, password),
  backToApp: () => ipcRenderer.invoke(IPC.navBackToApp),
  quit: () => ipcRenderer.invoke(IPC.quit),
  onShown: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: string) => {
      callback(snapshot);
    };
    ipcRenderer.on(IPC.dashboardLocked, listener);
    return () => {
      ipcRenderer.removeListener(IPC.dashboardLocked, listener);
    };
  },
};

contextBridge.exposeInMainWorld("ttmdLock", api);
