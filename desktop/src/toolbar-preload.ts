import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./shared/ipc";
import type { NavigationBridge, NavState } from "./shared/types";

const api: NavigationBridge = {
  back: () => ipcRenderer.invoke(IPC.navBack),
  forward: () => ipcRenderer.invoke(IPC.navForward),
  reload: () => ipcRenderer.invoke(IPC.navReload),
  home: () => ipcRenderer.invoke(IPC.navHome),
  backToApp: () => ipcRenderer.invoke(IPC.navBackToApp),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: NavState) => callback(state);
    ipcRenderer.on(IPC.navState, listener);
    return () => {
      ipcRenderer.removeListener(IPC.navState, listener);
    };
  },
};

contextBridge.exposeInMainWorld("ttmdNav", api);
