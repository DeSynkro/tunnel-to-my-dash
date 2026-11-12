import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./shared/ipc";
import type { ErrorBridge, ErrorState } from "./shared/types";

const api: ErrorBridge = {
  retry: () => ipcRenderer.invoke(IPC.errorRetry),
  backToApp: () => ipcRenderer.invoke(IPC.errorBackToApp),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ErrorState) =>
      callback(state);
    ipcRenderer.on(IPC.errorState, listener);
    return () => {
      ipcRenderer.removeListener(IPC.errorState, listener);
    };
  },
};

contextBridge.exposeInMainWorld("ttmdError", api);
