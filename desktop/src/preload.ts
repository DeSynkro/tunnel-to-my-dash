import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./shared/ipc";
import type { TtmdBridge } from "./shared/types";

const api: TtmdBridge = {
  getStatus: () => ipcRenderer.invoke(IPC.status),
  createVault: (password) => ipcRenderer.invoke(IPC.createVault, password),
  unlock: (password) => ipcRenderer.invoke(IPC.unlock, password),
  lock: () => ipcRenderer.invoke(IPC.lock),
  changePassword: (oldPassword, newPassword) =>
    ipcRenderer.invoke(IPC.changePassword, oldPassword, newPassword),
  addProfile: (input) => ipcRenderer.invoke(IPC.addProfile, input),
  updateProfile: (id, input) => ipcRenderer.invoke(IPC.updateProfile, id, input),
  deleteProfile: (id) => ipcRenderer.invoke(IPC.deleteProfile, id),
  activateProfile: (id) => ipcRenderer.invoke(IPC.activateProfile, id),
  checkProfile: (id) => ipcRenderer.invoke(IPC.checkProfile, id),
  connect: (id) => ipcRenderer.invoke(IPC.connect, id),
  disconnect: () => ipcRenderer.invoke(IPC.disconnect),
  chooseConfig: () => ipcRenderer.invoke(IPC.chooseConfig),
  onStatusChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.statusChanged, listener);
    return () => {
      ipcRenderer.removeListener(IPC.statusChanged, listener);
    };
  },
  quit: () => ipcRenderer.invoke(IPC.quit),
  version: () => ipcRenderer.invoke(IPC.version),
};

contextBridge.exposeInMainWorld("ttmd", api);
