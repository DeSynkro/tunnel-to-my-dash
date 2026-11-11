import type { NavigationBridge } from "../shared/types";

declare global {
  interface Window {
    ttmdNav: NavigationBridge;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element #${id}`);
  }
  return node as T;
}

const bridge = window.ttmdNav;
const appButton = element<HTMLButtonElement>("app");
const lockButton = element<HTMLButtonElement>("lock");
const back = element<HTMLButtonElement>("back");
const forward = element<HTMLButtonElement>("forward");
const reload = element<HTMLButtonElement>("reload");
const home = element<HTMLButtonElement>("home");
const address = element<HTMLElement>("address");

appButton.addEventListener("click", () => {
  void bridge.backToApp();
});
lockButton.addEventListener("click", () => {
  void bridge.lock();
});
back.addEventListener("click", () => {
  void bridge.back();
});
forward.addEventListener("click", () => {
  void bridge.forward();
});
reload.addEventListener("click", () => {
  void bridge.reload();
});
home.addEventListener("click", () => {
  void bridge.home();
});

bridge.onState((state) => {
  back.disabled = !state.canGoBack;
  forward.disabled = !state.canGoForward;
  lockButton.hidden = !state.passwordProtected;

  try {
    const url = new URL(state.url);
    address.textContent = url.host;
    address.title = state.url;
  } catch {
    address.textContent = "";
    address.title = "";
  }
});
