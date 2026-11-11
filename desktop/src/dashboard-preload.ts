import { ipcRenderer } from "electron";
import { IPC } from "./shared/ipc";
import type { LoginCandidate } from "./shared/types";

if (window.top === window) {
  let lastKey = "";
  let lastAt = 0;

  function visible(input: HTMLInputElement): boolean {
    if (input.disabled || input.readOnly) {
      return false;
    }
    return (
      input.offsetWidth > 0 ||
      input.offsetHeight > 0 ||
      input.getClientRects().length > 0
    );
  }

  function collectPasswordInputs(
    root: ParentNode,
    out: HTMLInputElement[] = [],
  ): HTMLInputElement[] {
    for (const node of root.querySelectorAll("*")) {
      if (node instanceof HTMLInputElement && node.type === "password") {
        out.push(node);
      }
      if (node instanceof HTMLElement && node.shadowRoot) {
        collectPasswordInputs(node.shadowRoot, out);
      }
    }
    return out;
  }

  function filledPasswords(): HTMLInputElement[] {
    return collectPasswordInputs(document).filter(
      (input) => visible(input) && input.value !== "",
    );
  }

  function passwordFor(event: Event): HTMLInputElement | null {
    const target = event.target instanceof Element ? event.target : null;
    if (target) {
      const form = target.closest("form");
      if (form) {
        const field = collectPasswordInputs(form).find(
          (input) => visible(input) && input.value !== "",
        );
        if (field) {
          return field;
        }
      }

      const button = target.closest(
        'button, input[type="submit"], [role="button"]',
      );
      if (!button) {
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement &&
          active.type === "password" &&
          active.value !== ""
        ) {
          return active;
        }
      }
    }

    const fields = filledPasswords();
    return fields.length === 1 ? fields[0] : null;
  }

  function usernameFor(password: HTMLInputElement): string {
    const root = password.closest("form") ?? document;
    const inputs = [
      ...root.querySelectorAll<HTMLInputElement>("input"),
    ].filter(
      (input) =>
        visible(input) && input.type !== "password" && input.type !== "hidden",
    );

    const autocomplete = inputs.find((input) =>
      ["username", "email"].includes(input.autocomplete),
    );
    if (autocomplete?.value.trim()) {
      return autocomplete.value.trim();
    }

    const hinted = inputs.find((input) => {
      const hint = `${input.name} ${input.id} ${input.placeholder}`.toLowerCase();
      return /user|login|email|account/.test(hint) && input.value.trim() !== "";
    });
    if (hinted) {
      return hinted.value.trim();
    }

    const all = [...root.querySelectorAll<HTMLInputElement>("input")];
    const index = all.indexOf(password);
    for (let i = index - 1; i >= 0; i--) {
      const input = all[i];
      if (
        input.type === "text" ||
        input.type === "email" ||
        input.type === "tel"
      ) {
        const value = input.value.trim();
        if (value) {
          return value;
        }
      }
    }
    return "";
  }

  function isLoginButton(element: Element): boolean {
    const label = (element.textContent ?? "").trim();
    const loginText = /log ?in|sign ?in|submit|unlock|continue/i;

    if (element instanceof HTMLInputElement) {
      if (element.type === "submit") {
        return true;
      }
      if (element.type === "button") {
        return loginText.test(element.value);
      }
      return false;
    }

    if (element instanceof HTMLButtonElement) {
      const type = element.getAttribute("type");
      if (type === "submit" || type === null || type === "") {
        return true;
      }
      return loginText.test(label);
    }

    return element.getAttribute("role") === "button" && loginText.test(label);
  }

  function capture(event: Event): void {
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      return;
    }

    const password = passwordFor(event);
    if (!password) {
      return;
    }

    const candidate: LoginCandidate = {
      url: location.origin,
      title: document.title,
      username: usernameFor(password),
      password: password.value,
    };
    const key = `${candidate.url}\n${candidate.username}\n${candidate.password}`;
    const now = Date.now();
    if (key === lastKey && now - lastAt < 1500) {
      return;
    }
    lastKey = key;
    lastAt = now;
    ipcRenderer.send(IPC.loginCandidate, candidate);
  }

  document.addEventListener("submit", capture, true);
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter") {
        return;
      }
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type === "password"
      ) {
        capture(event);
      }
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const button = event.target.closest(
        'button, input[type="submit"], input[type="button"], [role="button"]',
      );
      if (button && isLoginButton(button)) {
        capture(event);
      }
    },
    true,
  );
}
