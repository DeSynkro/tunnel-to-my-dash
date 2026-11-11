import { ipcRenderer } from "electron";
import { IPC } from "./shared/ipc";

let lastSent = 0;

window.addEventListener("mousemove", (event) => {
  const now = Date.now();
  if (now - lastSent < 50) {
    return;
  }
  lastSent = now;
  ipcRenderer.send(IPC.pointerView, {
    y: event.clientY,
    out: false,
  });
});

document.addEventListener("mouseleave", () => {
  ipcRenderer.send(IPC.pointerView, { y: -1, out: true });
});

window.addEventListener("blur", () => {
  ipcRenderer.send(IPC.pointerView, { y: -1, out: true });
});
