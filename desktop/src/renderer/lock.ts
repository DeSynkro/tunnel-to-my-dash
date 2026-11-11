import type { LockBridge } from "../shared/types";

declare global {
  interface Window {
    ttmdLock?: LockBridge;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element #${id}`);
  }
  return node as T;
}

const bridge = window.ttmdLock;
const form = element<HTMLFormElement>("lock-form");
const password = element<HTMLInputElement>("lock-password");
const error = element<HTMLElement>("lock-error");
const submit = element<HTMLButtonElement>("lock-submit");
const back = element<HTMLButtonElement>("lock-back");
const backdrop = element<HTMLElement>("lock-backdrop");

function message(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.message;
  }
  if (
    typeof caught === "object" &&
    caught !== null &&
    "message" in caught &&
    typeof (caught as { message: unknown }).message === "string"
  ) {
    return (caught as { message: string }).message;
  }
  return String(caught);
}

function setBusy(busy: boolean): void {
  if (busy) {
    submit.dataset.idle = submit.textContent ?? "";
    submit.textContent = "Unlocking…";
    submit.disabled = true;
  } else {
    if (submit.dataset.idle) {
      submit.textContent = submit.dataset.idle;
    }
    submit.disabled = false;
  }
}

if (!bridge) {
  error.textContent = "The lock bridge did not load";
  error.hidden = false;
} else {
  bridge.onShown((snapshot) => {
    if (snapshot) {
      backdrop.style.backgroundImage = `url("${snapshot}")`;
      backdrop.hidden = false;
      document.body.dataset.backdrop = "snapshot";
    } else {
      backdrop.style.backgroundImage = "";
      backdrop.hidden = true;
      document.body.dataset.backdrop = "plain";
    }
    form.reset();
    error.hidden = true;
    error.textContent = "";
    password.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    error.textContent = "";
    setBusy(true);
    try {
      await bridge.unlock(password.value);
      form.reset();
    } catch (caught) {
      error.textContent = message(caught);
      error.hidden = false;
      password.focus();
    } finally {
      setBusy(false);
    }
  });

  back.addEventListener("click", () => {
    void bridge.backToApp();
  });
}
