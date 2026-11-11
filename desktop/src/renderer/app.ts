import type {
  ConfigFile,
  ProfileInput,
  ProfileSummary,
  Status,
  TtmdBridge,
} from "../shared/types";

declare global {
  interface Window {
    ttmd?: TtmdBridge;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element #${id}`);
  }
  return node as T;
}

const bridge = window.ttmd;

const screens = {
  loading: element<HTMLElement>("screen-loading"),
  error: element<HTMLElement>("screen-error"),
  setup: element<HTMLElement>("screen-setup"),
  lock: element<HTMLElement>("screen-lock"),
  main: element<HTMLElement>("screen-main"),
};

const lockButton = element<HTMLButtonElement>("lock-button");
const quitButton = element<HTMLButtonElement>("quit-button");
const errorMessage = element<HTMLElement>("error-message");
const errorRetry = element<HTMLButtonElement>("error-retry");

const setupForm = element<HTMLFormElement>("setup-form");
const setupName = element<HTMLInputElement>("setup-name");
const setupChoose = element<HTMLButtonElement>("setup-choose");
const setupFile = element<HTMLElement>("setup-file");
const setupConfig = element<HTMLTextAreaElement>("setup-config");
const setupURL = element<HTMLInputElement>("setup-url");
const setupLock = element<HTMLInputElement>("setup-lock");
const setupPasswordField = element<HTMLElement>("setup-password-field");
const setupPassword = element<HTMLInputElement>("setup-password");
const setupError = element<HTMLElement>("setup-error");
const setupSubmit = element<HTMLButtonElement>("setup-submit");

const lockForm = element<HTMLFormElement>("lock-form");
const lockPassword = element<HTMLInputElement>("lock-password");
const lockError = element<HTMLElement>("lock-error");

const profileList = element<HTMLElement>("profile-list");
const profilesEmpty = element<HTMLElement>("profiles-empty");
const addProfileToggle = element<HTMLButtonElement>("add-profile-toggle");
const addForm = element<HTMLFormElement>("add-form");
const addName = element<HTMLInputElement>("add-name");
const addChoose = element<HTMLButtonElement>("add-choose");
const addFile = element<HTMLElement>("add-file");
const addConfig = element<HTMLTextAreaElement>("add-config");
const addURL = element<HTMLInputElement>("add-url");
const addError = element<HTMLElement>("add-error");
const addSubmit = element<HTMLButtonElement>("add-submit");
const addCancel = element<HTMLButtonElement>("add-cancel");
const mainNote = element<HTMLElement>("main-note");
const securityState = element<HTMLElement>("security-state");

let status: Status | null = null;
let addFormOpen = false;

function api(): TtmdBridge {
  if (!bridge) {
    throw new Error("The desktop bridge did not load.");
  }
  return bridge;
}

function showScreen(name: keyof typeof screens): void {
  for (const [key, node] of Object.entries(screens)) {
    node.hidden = key !== name;
  }
  document.body.dataset.screen = name;
  lockButton.hidden = name !== "main" || !status?.password_protected;
}

function showError(text: string): void {
  errorMessage.textContent = text;
  showScreen("error");
}

function message(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

function setFormError(target: HTMLElement, text: string): void {
  target.textContent = text;
  target.hidden = text.length === 0;
}

function setBusy(button: HTMLButtonElement, busy: boolean, label = "Working…"): void {
  if (busy) {
    button.dataset.idle = button.textContent ?? "";
    button.textContent = label;
    button.disabled = true;
  } else {
    if (button.dataset.idle) {
      button.textContent = button.dataset.idle;
    }
    button.disabled = false;
  }
}

function makeButton(label: string, className = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = className;
  return button;
}

async function chooseConfig(
  textarea: HTMLTextAreaElement,
  fileName: HTMLElement,
): Promise<void> {
  try {
    const file: ConfigFile | null = await api().chooseConfig();
    if (!file) {
      return;
    }
    textarea.value = file.text;
    fileName.textContent = file.name;
  } catch (error) {
    showError(message(error));
  }
}

async function refresh(): Promise<void> {
  showScreen("loading");
  try {
    status = await api().getStatus();
    if (status.error) {
      showError(status.error);
      return;
    }
    if (!status.has_vault) {
      showScreen("setup");
      return;
    }
    if (status.locked) {
      showScreen("lock");
      lockPassword.focus();
      return;
    }
    showMain();
  } catch (error) {
    showError(message(error));
  }
}

function showMain(): void {
  if (!status) {
    return;
  }

  showScreen("main");
  lockButton.hidden = !status.password_protected;

  profileList.replaceChildren(
    ...status.profiles.map((profile) => profileCard(profile)),
  );
  profilesEmpty.hidden = status.profiles.length > 0;
  addForm.hidden = status.profiles.length > 0 ? !addFormOpen : false;

  if (status.connected && status.proxy) {
    mainNote.textContent = `Tunnel is up on ${status.proxy}.`;
  } else {
    mainNote.textContent = "Open a dashboard to start the tunnel.";
  }

  securityState.textContent = status.password_protected
    ? "App lock is on. The vault needs your password after a restart."
    : "App lock is off. The vault opens with a 0600 key file in the app data folder.";
}

function profileCard(profile: ProfileSummary): HTMLElement {
  const card = document.createElement("article");
  card.className = "profile";

  const head = document.createElement("div");
  head.className = "profile-head";

  const title = document.createElement("h3");
  title.textContent = profile.name;
  head.append(title);

  if (status?.active_profile === profile.id) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Active";
    head.append(badge);
  }

  const url = document.createElement("p");
  url.className = "profile-url";
  url.textContent = profile.dashboard_url;

  const actions = document.createElement("div");
  actions.className = "profile-actions";

  const connect = makeButton("Open dashboard");
  connect.addEventListener("click", async () => {
    setBusy(connect, true, "Opening…");
    try {
      await api().connect(profile.id);
    } catch (error) {
      mainNote.textContent = message(error);
      setBusy(connect, false);
    }
  });
  actions.append(connect);

  if (status?.active_profile !== profile.id) {
    const activate = makeButton("Make active", "ghost");
    activate.addEventListener("click", async () => {
      try {
        await api().activateProfile(profile.id);
        await refresh();
      } catch (error) {
        mainNote.textContent = message(error);
      }
    });
    actions.append(activate);
  }

  const remove = makeButton("Delete", "ghost danger");
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Delete "${profile.name}"?`)) {
      return;
    }
    try {
      await api().deleteProfile(profile.id);
      await refresh();
    } catch (error) {
      mainNote.textContent = message(error);
    }
  });
  actions.append(remove);

  card.append(head, url, actions);
  return card;
}

async function submitSetup(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setFormError(setupError, "");

  const name = setupName.value.trim();
  const config = setupConfig.value.trim();
  const url = setupURL.value.trim();
  const wantsPassword = setupLock.checked;
  const password = setupPassword.value;

  if (!name) {
    setFormError(setupError, "Give the profile a name.");
    return;
  }
  if (!config) {
    setFormError(setupError, "Choose a WireGuard config file or paste its contents.");
    return;
  }
  if (!url) {
    setFormError(setupError, "Enter the dashboard URL.");
    return;
  }
  if (wantsPassword && !password) {
    setFormError(setupError, "Enter a password, or turn the app lock off.");
    return;
  }

  setBusy(setupSubmit, true, "Creating…");

  let vaultCreated = false;
  try {
    try {
      await api().createVault(wantsPassword ? password : "");
      vaultCreated = true;
    } catch (error) {
      if (!/already exists/i.test(message(error))) {
        throw error;
      }
      vaultCreated = true;
    }

    await api().addProfile({
      name,
      tunnel_config: config,
      dashboard_url: url,
      allow_external: false,
    });

    setupForm.reset();
    setupPasswordField.hidden = true;
    setupFile.textContent = "No file chosen";
    await refresh();
  } catch (error) {
    const text = message(error);
    setFormError(setupError, text);
    if (vaultCreated) {
      await refresh();
      mainNote.textContent = `Profile not saved: ${text}`;
    }
  } finally {
    setBusy(setupSubmit, false);
  }
}

async function submitAdd(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setFormError(addError, "");

  const name = addName.value.trim();
  const config = addConfig.value.trim();
  const url = addURL.value.trim();

  if (!name) {
    setFormError(addError, "Give the profile a name.");
    return;
  }
  if (!config) {
    setFormError(addError, "Choose a WireGuard config file or paste its contents.");
    return;
  }
  if (!url) {
    setFormError(addError, "Enter the dashboard URL.");
    return;
  }

  setBusy(addSubmit, true, "Saving…");
  try {
    const input: ProfileInput = {
      name,
      tunnel_config: config,
      dashboard_url: url,
      allow_external: false,
    };
    await api().addProfile(input);
    addForm.reset();
    addFormOpen = false;
    addFile.textContent = "No file chosen";
    await refresh();
  } catch (error) {
    setFormError(addError, message(error));
  } finally {
    setBusy(addSubmit, false);
  }
}

async function submitUnlock(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  setFormError(lockError, "");

  const submit = lockForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) {
    setBusy(submit, true, "Unlocking…");
  }

  try {
    await api().unlock(lockPassword.value);
    lockForm.reset();
    await refresh();
  } catch (error) {
    setFormError(lockError, message(error));
  } finally {
    if (submit) {
      setBusy(submit, false);
    }
  }
}

setupLock.addEventListener("change", () => {
  setupPasswordField.hidden = !setupLock.checked;
  if (!setupLock.checked) {
    setupPassword.value = "";
  }
});

setupChoose.addEventListener("click", () => {
  void chooseConfig(setupConfig, setupFile);
});

setupForm.addEventListener("submit", (event) => {
  void submitSetup(event);
});

lockForm.addEventListener("submit", (event) => {
  void submitUnlock(event);
});

addProfileToggle.addEventListener("click", () => {
  addFormOpen = !addFormOpen;
  addForm.hidden = !addFormOpen;
  if (addFormOpen) {
    setFormError(addError, "");
    addName.focus();
  }
});

addChoose.addEventListener("click", () => {
  void chooseConfig(addConfig, addFile);
});

addCancel.addEventListener("click", () => {
  addFormOpen = false;
  addForm.hidden = true;
  setFormError(addError, "");
});

addForm.addEventListener("submit", (event) => {
  void submitAdd(event);
});

lockButton.addEventListener("click", async () => {
  try {
    await api().lock();
    await refresh();
  } catch (error) {
    mainNote.textContent = message(error);
  }
});

quitButton.addEventListener("click", () => {
  void api().quit();
});

errorRetry.addEventListener("click", () => {
  void refresh();
});

if (bridge) {
  bridge.onStatusChanged(() => {
    void refresh();
  });
  void refresh();
} else {
  showError("The desktop bridge did not load.");
}
