const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("testIpc", {
  call: () => ipcRenderer.invoke("test:ipc-trust"),
});
