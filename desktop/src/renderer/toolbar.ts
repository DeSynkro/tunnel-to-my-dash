import type {
  CredentialField,
  CredentialSummary,
  NavigationBridge,
} from "../shared/types";

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
const passwordsButton = element<HTMLButtonElement>("passwords");
const passwordsPanel = element<HTMLElement>("passwords-panel");
const passwordsList = element<HTMLElement>("passwords-list");
const passwordsCount = element<HTMLElement>("passwords-count");
const passwordsToast = element<HTMLElement>("passwords-toast");

let credentials: CredentialSummary[] = [];
let panelOpen = false;
let toastOpen = false;
let toastTimer: number | null = null;
let warnTimer: number | null = null;

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
passwordsButton.addEventListener("click", () => {
  if (credentials.length === 0) {
    showEmptyToast();
    return;
  }

  hideToast(false);
  if (panelOpen) {
    hidePanel();
    return;
  }
  void openPanel();
});

function renderCredentials(): void {
  passwordsButton.hidden = false;
  passwordsCount.textContent =
    credentials.length === 0 ? "" : `${credentials.length} saved`;
  passwordsList.replaceChildren();

  for (const credential of credentials) {
    const row = document.createElement("div");
    row.className = "credential";

    const info = document.createElement("div");
    info.className = "credential-info";
    const name = document.createElement("strong");
    name.textContent = credential.name;
    name.title = credential.name;
    const detail = document.createElement("span");
    detail.textContent = credential.username || "No username";
    detail.title = credential.username || "";
    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "credential-actions";
    if (credential.username) {
      const user = document.createElement("button");
      user.type = "button";
      user.textContent = "Username";
      user.title = "Copy username";
      user.addEventListener("click", () => {
        void copyCredential(credential.id, "username", user);
      });
      actions.append(user);
    }
    const password = document.createElement("button");
    password.type = "button";
    password.textContent = "Password";
    password.title = "Copy password";
    password.addEventListener("click", () => {
      void copyCredential(credential.id, "password", password);
    });
    actions.append(password);

    row.append(info, actions);
    passwordsList.append(row);
  }
}

async function copyCredential(
  credentialID: string,
  field: CredentialField,
  button: HTMLButtonElement,
): Promise<void> {
  const label = button.textContent ?? "";
  button.disabled = true;
  try {
    await bridge.copyCredential(credentialID, field);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Failed";
  }
  window.setTimeout(() => {
    button.textContent = label;
    button.disabled = false;
  }, 1200);
}

async function openPanel(): Promise<void> {
  if (panelOpen || credentials.length === 0) {
    return;
  }

  panelOpen = true;
  passwordsButton.setAttribute("aria-expanded", "true");
  passwordsPanel.hidden = false;
  const height = Math.ceil(passwordsPanel.getBoundingClientRect().height);
  try {
    await bridge.openPanel(height);
    passwordsPanel.classList.add("open");
  } catch {
    panelOpen = false;
    passwordsPanel.hidden = true;
    passwordsButton.setAttribute("aria-expanded", "false");
  }
}

function hidePanel(notify = true): void {
  if (!panelOpen) {
    return;
  }

  panelOpen = false;
  passwordsPanel.classList.remove("open");
  passwordsPanel.hidden = true;
  passwordsButton.setAttribute("aria-expanded", "false");
  if (notify) {
    void bridge.closePanel();
  }
}

function showEmptyToast(): void {
  if (toastOpen) {
    return;
  }

  hidePanel();
  toastOpen = true;
  passwordsButton.classList.add("warn");
  if (warnTimer !== null) {
    window.clearTimeout(warnTimer);
  }
  warnTimer = window.setTimeout(() => {
    warnTimer = null;
    passwordsButton.classList.remove("warn");
  }, 700);

  passwordsToast.hidden = false;
  const height = Math.ceil(passwordsToast.getBoundingClientRect().height);
  void bridge
    .openPanel(height)
    .then(() => {
      passwordsToast.classList.add("open");
      if (toastTimer !== null) {
        window.clearTimeout(toastTimer);
      }
      toastTimer = window.setTimeout(() => hideToast(), 2400);
    })
    .catch(() => {
      toastOpen = false;
      passwordsToast.hidden = true;
    });
}

function hideToast(notify = true): void {
  if (!toastOpen) {
    return;
  }

  toastOpen = false;
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
  passwordsToast.classList.remove("open");
  passwordsToast.hidden = true;
  if (notify) {
    void bridge.closePanel();
  }
}

bridge.onCredentials((state) => {
  credentials = state.credentials;
  renderCredentials();
  if (credentials.length === 0) {
    hidePanel();
  } else {
    hideToast();
  }
});

bridge.onPanelState((state) => {
  if (!state.open) {
    hidePanel(false);
    hideToast(false);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hidePanel();
  }
});

bridge.onState((state) => {
  back.disabled = !state.canGoBack;
  forward.disabled = !state.canGoForward;
  lockButton.hidden = !state.passwordProtected;
  document.body.dataset.mode = state.mode;
  if (state.mode === "peek") {
    hidePanel(false);
    hideToast(false);
  }

  try {
    const url = new URL(state.url);
    address.textContent = url.host;
    address.title = state.url;
  } catch {
    address.textContent = "";
    address.title = "";
  }
});
