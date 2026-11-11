import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("ttmd", {
  version: "0.1.0",
});
