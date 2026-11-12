import type { ErrorBridge } from "../shared/types";

declare global {
  interface Window {
    ttmdError: ErrorBridge;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element #${id}`);
  }
  return node as T;
}

const bridge = window.ttmdError;
const title = element<HTMLElement>("error-title");
const detail = element<HTMLElement>("error-detail");
const retry = element<HTMLButtonElement>("error-retry");
const back = element<HTMLButtonElement>("error-back");

bridge.onState((state) => {
  title.textContent = state.title;
  detail.textContent = state.detail;
  retry.disabled = state.busy === true;
  retry.textContent = state.busy ? "Reconnecting…" : "Try again";
  back.disabled = state.busy === true;
});

retry.addEventListener("click", () => {
  void bridge.retry();
});

back.addEventListener("click", () => {
  void bridge.backToApp();
});
