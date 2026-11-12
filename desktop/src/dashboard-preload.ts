import { ipcRenderer } from "electron";
import { IPC } from "./shared/ipc";
import type {
  AutofillRequest,
  AutofillResult,
  LoginCandidate,
} from "./shared/types";

if (window.top === window) {
  let lastFingerprint = "";
  let lastAt = 0;
  let lastGestureAt = 0;
  const gestureWindowMs = 5000;

  function fingerprint(value: string): string {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

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

  function filledPasswords(root: ParentNode): HTMLInputElement[] {
    return collectPasswordInputs(root).filter(
      (input) => visible(input) && input.value !== "",
    );
  }

  function pickPassword(root: ParentNode): HTMLInputElement | null {
    const fields = filledPasswords(root);
    if (fields.length === 0) {
      return null;
    }
    const fresh = fields.find((input) => input.autocomplete === "new-password");
    if (fresh) {
      return fresh;
    }
    const other = fields.find(
      (input) => input.autocomplete !== "current-password",
    );
    return other ?? fields[0];
  }

  function nearestContainerWithPassword(element: Element): Element | null {
    let node: Element | null = element.parentElement;
    for (let depth = 0; depth < 6 && node; depth++) {
      if (filledPasswords(node).length > 0) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function passwordFor(event: Event): HTMLInputElement | null {
    const target = event.target instanceof Element ? event.target : null;

    if (event.type === "keydown") {
      if (
        target instanceof HTMLInputElement &&
        target.type === "password" &&
        visible(target) &&
        target.value !== ""
      ) {
        return target;
      }
      return null;
    }

    if (!target) {
      return null;
    }
    const scope =
      target.closest("form") ?? nearestContainerWithPassword(target);
    return scope ? pickPassword(scope) : null;
  }

  function usernameInputFor(
    password: HTMLInputElement,
  ): HTMLInputElement | null {
    const root = password.closest("form") ?? document;
    const inputs = [
      ...root.querySelectorAll<HTMLInputElement>("input"),
    ].filter(
      (input) =>
        visible(input) &&
        (input.type === "text" ||
          input.type === "email" ||
          input.type === "tel"),
    );

    const autocomplete = inputs.find((input) =>
      ["username", "email"].includes(input.autocomplete),
    );
    if (autocomplete) {
      return autocomplete;
    }

    const hinted = inputs.find((input) => {
      if (input.autocomplete === "one-time-code") {
        return false;
      }
      const hint = `${input.name} ${input.id} ${input.placeholder}`.toLowerCase();
      if (/(otp|one.?time|code|token)/.test(hint)) {
        return false;
      }
      return /(user|email|account|login)/.test(hint);
    });
    if (hinted) {
      return hinted;
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
        return input;
      }
    }
    return null;
  }

  function usernameFor(password: HTMLInputElement): string {
    return usernameInputFor(password)?.value.trim() ?? "";
  }

  function loginFields(): {
    password: HTMLInputElement;
    username: HTMLInputElement | null;
  } | null {
    const passwords = collectPasswordInputs(document).filter(
      (input) => visible(input) && !input.disabled && !input.readOnly,
    );
    let fallback: {
      password: HTMLInputElement;
      username: HTMLInputElement | null;
    } | null = null;
    for (const password of passwords) {
      const username = usernameInputFor(password);
      if (username) {
        return { password, username };
      }
      if (!fallback) {
        fallback = { password, username: null };
      }
    }
    return fallback;
  }

  function setInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillLogin(request: AutofillRequest): AutofillResult {
    const fields = loginFields();
    if (!fields) {
      return { ok: false, username: false, password: false };
    }
    let username = false;
    if (fields.username && request.username) {
      setInputValue(fields.username, request.username);
      username = true;
    }
    setInputValue(fields.password, request.password);
    fields.password.focus();
    return { ok: true, username, password: true };
  }

  function isLoginButton(element: Element): boolean {
    const loginText = /log ?in|sign ?in|submit|unlock|continue/i;

    if (element instanceof HTMLInputElement) {
      if (element.type === "submit") {
        return true;
      }
      return element.type === "button" && loginText.test(element.value);
    }

    if (element instanceof HTMLButtonElement) {
      const type = element.getAttribute("type");
      if (type === "submit") {
        return true;
      }
      const label = `${element.textContent ?? ""} ${
        element.getAttribute("aria-label") ?? ""
      } ${element.title}`.trim();
      return loginText.test(label);
    }

    const label = `${element.textContent ?? ""} ${
      element.getAttribute("aria-label") ?? ""
    }`;
    return element.getAttribute("role") === "button" && loginText.test(label);
  }

  function markGesture(event: Event): void {
    if (event.isTrusted) {
      lastGestureAt = Date.now();
    }
  }

  function capture(event: Event): void {
    if (!event.isTrusted) {
      return;
    }
    if (Date.now() - lastGestureAt > gestureWindowMs) {
      return;
    }
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      return;
    }

    const password = passwordFor(event);
    if (!password) {
      return;
    }

    const candidate: LoginCandidate = {
      url: location.origin,
      page: location.href,
      title: document.title,
      username: usernameFor(password),
      password: password.value,
    };
    const key = fingerprint(
      `${candidate.url}\n${candidate.username}\n${candidate.password}`,
    );
    const now = Date.now();
    if (key === lastFingerprint && now - lastAt < 1500) {
      return;
    }
    lastFingerprint = key;
    lastAt = now;
    ipcRenderer.send(IPC.loginCandidate, candidate);
  }

  document.addEventListener("pointerdown", markGesture, true);
  document.addEventListener("keydown", markGesture, true);
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

  ipcRenderer.on(IPC.autofillLogin, (_event, request: AutofillRequest) => {
    if (
      typeof request !== "object" ||
      request === null ||
      typeof request.id !== "string" ||
      typeof request.username !== "string" ||
      typeof request.password !== "string"
    ) {
      return;
    }
    ipcRenderer.send(IPC.autofillResult, request.id, fillLogin(request));
  });
}
