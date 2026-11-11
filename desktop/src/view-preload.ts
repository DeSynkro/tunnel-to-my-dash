import { ipcRenderer } from "electron";
import { IPC } from "./shared/ipc";

let lastSent = 0;
let lastY = -1;

function sendPointer(y: number, out: boolean): void {
  ipcRenderer.send(IPC.pointerView, { y, out });
}

window.addEventListener("mousemove", (event) => {
  lastY = event.clientY;
  const now = Date.now();
  if (now - lastSent < 50) {
    return;
  }
  lastSent = now;
  sendPointer(lastY, false);
});

window.addEventListener("mousedown", (event) => {
  lastY = event.clientY;
  sendPointer(lastY, false);
});

window.addEventListener("focus", () => {
  if (lastY >= 0) {
    sendPointer(lastY, false);
  }
});

document.addEventListener("mouseleave", () => {
  sendPointer(-1, true);
});

window.addEventListener("blur", () => {
  sendPointer(-1, true);
});
