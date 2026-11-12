import { ipcRenderer } from "electron";
import { IPC } from "./shared/ipc";
import type {
  AutofillRequest,
  AutofillResult,
  InlineFillAvailability,
  InlineFillResult,
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

  let successObserver: MutationObserver | null = null;
  let successTimer: number | null = null;

  function clearSuccessWatch(): void {
    if (successObserver) {
      successObserver.disconnect();
      successObserver = null;
    }
    if (successTimer !== null) {
      window.clearInterval(successTimer);
      successTimer = null;
    }
  }

  function watchLoginSuccess(field: HTMLInputElement): void {
    clearSuccessWatch();
    const started = Date.now();
    let sent = false;
    const check = () => {
      if (sent) {
        return;
      }
      if (!field.isConnected || !visible(field)) {
        sent = true;
        clearSuccessWatch();
        ipcRenderer.send(IPC.loginSuccess);
        return;
      }
      if (Date.now() - started > 10_000) {
        clearSuccessWatch();
      }
    };

    successObserver = new MutationObserver(check);
    successObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "type"],
    });
    successTimer = window.setInterval(check, 500);
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
    watchLoginSuccess(password);
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

  type LoginFillFields = {
    password: HTMLInputElement;
    username: HTMLInputElement | null;
  };

  let activeAnchor: HTMLInputElement | null = null;
  let activeFields: LoginFillFields | null = null;
  let hideTimer: number | null = null;
  let positionTimer: number | null = null;

  const fillHost = document.createElement("div");
  fillHost.id = "__ttmd_fill_host";
  fillHost.style.cssText =
    "position:fixed;z-index:2147483647;display:none;pointer-events:auto;";
  const fillShadow = fillHost.attachShadow({ mode: "closed" });
  const fillButton = document.createElement("button");
  fillButton.type = "button";
  fillButton.textContent = "Fill";
  fillButton.title = "Fill saved login";
  fillButton.style.cssText = [
    "all:initial",
    "display:block",
    "box-sizing:border-box",
    "padding:5px 10px",
    "border:1px solid rgba(240,163,90,.5)",
    "border-radius:8px",
    "background:rgba(14,14,14,.96)",
    "color:#ece7dd",
    "font:600 11px/1.2 system-ui,sans-serif",
    "cursor:pointer",
    "box-shadow:0 8px 24px rgba(0,0,0,.45)",
  ].join(";");
  fillShadow.append(fillButton);

  function ensureFillHost(): void {
    if (fillHost.isConnected) {
      return;
    }
    if (document.documentElement) {
      document.documentElement.append(fillHost);
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => document.documentElement.append(fillHost),
        { once: true },
      );
    }
  }
  ensureFillHost();

  function loginFieldsFor(field: HTMLInputElement): LoginFillFields | null {
    if (!visible(field) || field.disabled || field.readOnly) {
      return null;
    }

    if (field.type === "password") {
      if (field.autocomplete === "new-password") {
        return null;
      }
      const form = field.closest("form");
      if (form) {
        const passwords = collectPasswordInputs(form).filter(visible);
        if (passwords.length > 1) {
          return null;
        }
      }
      return { password: field, username: usernameInputFor(field) };
    }

    if (
      field.type !== "text" &&
      field.type !== "email" &&
      field.type !== "tel"
    ) {
      return null;
    }

    const form = field.closest("form");
    const scope: ParentNode = form ?? document;
    const passwords = collectPasswordInputs(scope).filter(visible);
    if (passwords.length !== 1) {
      return null;
    }
    const password = passwords[0];
    if (password.autocomplete === "new-password") {
      return null;
    }
    const username = usernameInputFor(password);
    if (username !== field) {
      return null;
    }
    return { password, username };
  }

  function positionFillPill(): void {
    const anchor = activeAnchor;
    if (!anchor || !anchor.isConnected) {
      hideFillPill();
      return;
    }
    ensureFillHost();
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hideFillPill();
      return;
    }
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      fillHost.style.display = "none";
      return;
    }
    const width = 44;
    const height = 26;
    const left = Math.min(
      window.innerWidth - width - 8,
      Math.max(8, rect.right - width),
    );
    const top = Math.max(
      8,
      Math.min(
        window.innerHeight - height - 8,
        rect.top + (rect.height - height) / 2,
      ),
    );
    fillHost.style.left = `${left}px`;
    fillHost.style.top = `${top}px`;
    fillHost.style.display = "block";
  }

  function hideFillPill(): void {
    activeAnchor = null;
    activeFields = null;
    fillHost.style.display = "none";
    if (positionTimer !== null) {
      window.clearInterval(positionTimer);
      positionTimer = null;
    }
  }

  async function showFillPill(
    anchor: HTMLInputElement,
    fields: LoginFillFields,
  ): Promise<void> {
    activeAnchor = anchor;
    activeFields = fields;
    let availability: InlineFillAvailability;
    try {
      availability = (await ipcRenderer.invoke(
        IPC.inlineFillAvailable,
      )) as InlineFillAvailability;
    } catch {
      hideFillPill();
      return;
    }
    if (activeAnchor !== anchor || !anchor.isConnected) {
      return;
    }
    if (!availability.available) {
      hideFillPill();
      return;
    }
    fillButton.title = availability.name
      ? `Fill saved login for ${availability.name}`
      : "Fill saved login";
    positionFillPill();
    if (positionTimer === null) {
      positionTimer = window.setInterval(positionFillPill, 250);
    }
  }

  function scheduleHideFillPill(): void {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
    }
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      hideFillPill();
    }, 200);
  }

  function loginInputFromPath(event: Event): HTMLInputElement | null {
    for (const node of event.composedPath()) {
      if (
        node instanceof HTMLInputElement &&
        (node.type === "password" ||
          node.type === "text" ||
          node.type === "email" ||
          node.type === "tel") &&
        visible(node)
      ) {
        return node;
      }
    }
    return null;
  }

  document.addEventListener(
    "focusin",
    (event) => {
      const field = loginInputFromPath(event);
      if (field) {
        const fields = loginFieldsFor(field);
        if (fields) {
          if (hideTimer !== null) {
            window.clearTimeout(hideTimer);
            hideTimer = null;
          }
          void showFillPill(field, fields);
          return;
        }
      }
      scheduleHideFillPill();
    },
    true,
  );

  document.addEventListener(
    "focusout",
    (event) => {
      if (loginInputFromPath(event)) {
        scheduleHideFillPill();
      }
    },
    true,
  );

  window.addEventListener(
    "scroll",
    () => {
      if (activeAnchor) {
        positionFillPill();
      }
    },
    true,
  );
  window.addEventListener("resize", () => {
    if (activeAnchor) {
      positionFillPill();
    }
  });

  fillButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  fillButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted) {
      return;
    }
    const fields = activeFields;
    if (!fields) {
      return;
    }
    hideFillPill();
    void fillInline(fields);
  });

  async function fillInline(fields: LoginFillFields): Promise<void> {
    let result: InlineFillResult;
    try {
      result = (await ipcRenderer.invoke(IPC.inlineFill)) as InlineFillResult;
    } catch {
      return;
    }
    if (
      !result.ok ||
      typeof result.password !== "string" ||
      !fields.password.isConnected
    ) {
      return;
    }
    if (
      fields.username &&
      fields.username.isConnected &&
      result.username
    ) {
      setInputValue(fields.username, result.username);
    }
    setInputValue(fields.password, result.password);
    fields.password.focus();
  }
}
