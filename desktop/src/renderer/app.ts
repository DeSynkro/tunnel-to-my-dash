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
  settings: element<HTMLElement>("screen-settings"),
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
const setupPasswordHint = element<HTMLElement>("setup-password-hint");
const setupPasswordConfirmField = element<HTMLElement>("setup-password-confirm-field");
const setupPasswordConfirm = element<HTMLInputElement>("setup-password-confirm");
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
const appVersion = element<HTMLElement>("app-version");

const rail = element<HTMLElement>("rail");
const navDashboards = element<HTMLButtonElement>("nav-dashboards");
const settingsToggle = element<HTMLButtonElement>("settings-toggle");
const settingsBack = element<HTMLButtonElement>("settings-back");
const securityDot = element<HTMLElement>("security-dot");
const tunnelDot = element<HTMLElement>("tunnel-dot");
const settingsProfiles = element<HTMLElement>("settings-profiles");
const settingsLockState = element<HTMLElement>("settings-lock-state");
const settingsPasswordForm = element<HTMLFormElement>("settings-password-form");
const settingsOldPasswordField = element<HTMLElement>("settings-old-password-field");
const settingsOldPassword = element<HTMLInputElement>("settings-old-password");
const settingsNewPassword = element<HTMLInputElement>("settings-new-password");
const settingsNewPasswordConfirm = element<HTMLInputElement>("settings-new-password-confirm");
const settingsPasswordHint = element<HTMLElement>("settings-password-hint");
const settingsPasswordError = element<HTMLElement>("settings-password-error");
const settingsPasswordNote = element<HTMLElement>("settings-password-note");
const settingsPasswordSubmit = element<HTMLButtonElement>("settings-password-submit");
const settingsPasswordRemove = element<HTMLButtonElement>("settings-password-remove");

let status: Status | null = null;
let addFormOpen = false;
let settingsOpen = false;

function api(): TtmdBridge {
  if (!bridge) {
    throw new Error("The desktop bridge did not load");
  }
  return bridge;
}

function showScreen(name: keyof typeof screens): void {
  for (const [key, node] of Object.entries(screens)) {
    node.hidden = key !== name;
  }
  document.body.dataset.screen = name;

  const appLayout = name === "main" || name === "settings";
  rail.hidden = !appLayout;
  document.body.classList.toggle("layout-app", appLayout);
  navDashboards.classList.toggle("active", name === "main");
  settingsToggle.classList.toggle("active", name === "settings");
  if (name === "main") {
    navDashboards.setAttribute("aria-current", "page");
  } else {
    navDashboards.removeAttribute("aria-current");
  }
  if (name === "settings") {
    settingsToggle.setAttribute("aria-current", "page");
  } else {
    settingsToggle.removeAttribute("aria-current");
  }

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
      settingsOpen = false;
      showScreen("lock");
      lockPassword.focus();
      return;
    }
    if (settingsOpen) {
      showSettings();
    } else {
      showMain();
    }
  } catch (error) {
    showError(message(error));
  }
}

function showMain(): void {
  if (!status) {
    return;
  }

  settingsOpen = false;
  showScreen("main");
  lockButton.hidden = !status.password_protected;

  profileList.replaceChildren(
    ...status.profiles.map((profile) => profileCard(profile)),
  );
  profilesEmpty.hidden = status.profiles.length > 0;
  addForm.hidden = status.profiles.length > 0 ? !addFormOpen : false;

  tunnelDot.classList.toggle("on", status.connected);
  if (status.connected && status.proxy) {
    mainNote.textContent = `Tunnel up on ${status.proxy}`;
  } else {
    mainNote.textContent = "Open a dashboard to start the tunnel";
  }

  renderRail();
}

function renderRail(): void {
  if (!status) {
    return;
  }
  securityState.textContent = status.password_protected ? "Password" : "Key file";
  securityState.title = status.password_protected
    ? "The vault needs your password after a restart"
    : "The vault opens with a 0600 key file in the app data folder";
  securityDot.classList.toggle("on", status.password_protected);
}

function profileCard(profile: ProfileSummary): HTMLElement {
  const card = document.createElement("article");
  card.className = "profile";

  const main = document.createElement("div");
  main.className = "profile-main";

  const head = document.createElement("div");
  head.className = "profile-head";

  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.classList.toggle("on", status?.active_profile === profile.id);
  head.append(dot);

  const title = document.createElement("h3");
  title.textContent = profile.name;
  head.append(title);

  if (status?.active_profile === profile.id) {
    const state = document.createElement("span");
    state.className = "profile-state";
    state.textContent = "Active";
    head.append(state);
  }

  if (profile.allow_external) {
    const state = document.createElement("span");
    state.className = "profile-state";
    state.textContent = "External";
    head.append(state);
  }

  const url = document.createElement("p");
  url.className = "profile-url";
  url.textContent = profile.dashboard_url;

  main.append(head, url);

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

  card.append(main, actions);
  return card;
}

function showSettings(): void {
  if (!status || status.locked) {
    return;
  }
  settingsOpen = true;
  renderSettings();
  renderRail();
  showScreen("settings");
}

function renderSettings(): void {
  if (!status) {
    return;
  }

  settingsProfiles.replaceChildren(
    ...status.profiles.map((profile) => settingsProfileCard(profile)),
  );

  settingsLockState.textContent = status.password_protected
    ? "App lock is on. The vault needs your password after a restart."
    : "App lock is off. The vault opens with a 0600 key file in the app data folder.";
  settingsOldPasswordField.hidden = !status.password_protected;
  settingsPasswordRemove.hidden = !status.password_protected;
  settingsPasswordSubmit.textContent = status.password_protected
    ? "Change password"
    : "Turn on app lock";

  settingsPasswordForm.reset();
  setFormError(settingsPasswordError, "");
  settingsPasswordNote.hidden = true;
  settingsPasswordHint.hidden = true;
  settingsPasswordHint.textContent = "";
}

function settingsProfileCard(profile: ProfileSummary): HTMLElement {
  const card = document.createElement("article");
  card.className = "settings-profile";

  const nameField = document.createElement("label");
  nameField.className = "field";
  const nameLabel = document.createElement("span");
  nameLabel.textContent = "Profile name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 64;
  nameInput.value = profile.name;
  nameInput.className = "settings-profile-name";
  nameField.append(nameLabel, nameInput);

  const urlField = document.createElement("label");
  urlField.className = "field";
  const urlLabel = document.createElement("span");
  urlLabel.textContent = "Dashboard URL";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.value = profile.dashboard_url;
  urlInput.className = "settings-profile-url";
  urlField.append(urlLabel, urlInput);

  const externalBlock = document.createElement("div");
  externalBlock.className = "settings-external";

  const externalLabel = document.createElement("label");
  externalLabel.className = "check";
  externalLabel.title =
    "Off by default. External requests use your normal network or VPN, not the LAN tunnel.";
  const externalInput = document.createElement("input");
  externalInput.type = "checkbox";
  externalInput.className = "settings-profile-external";
  externalInput.checked = profile.allow_external;
  const externalText = document.createElement("span");
  externalText.textContent = "Allow external content";
  externalLabel.append(externalInput, externalText);

  const externalHint = document.createElement("p");
  externalHint.className = "hint";
  externalHint.textContent =
    "Loads only the exact origins below. Everything else stays blocked.";

  const originsField = document.createElement("label");
  originsField.className = "field settings-origins";
  originsField.hidden = !profile.allow_external;
  const originsLabel = document.createElement("span");
  originsLabel.textContent = "Allowed external origins";
  const originsInput = document.createElement("textarea");
  originsInput.rows = 3;
  originsInput.spellcheck = false;
  originsInput.className = "settings-profile-origins";
  originsInput.placeholder = "https://fonts.googleapis.com\nhttps://cdn.jsdelivr.net";
  originsInput.value = (profile.external_origins ?? []).join("\n");
  const originsHint = document.createElement("span");
  originsHint.className = "hint";
  originsHint.textContent = "One origin per line. Paths and wildcards are not allowed.";
  originsField.append(originsLabel, originsInput, originsHint);

  externalInput.addEventListener("change", () => {
    originsField.hidden = !externalInput.checked;
  });

  externalBlock.append(externalLabel, externalHint, originsField);

  const formError = document.createElement("p");
  formError.className = "form-error";
  formError.hidden = true;

  const actions = document.createElement("div");
  actions.className = "actions";
  const save = makeButton("Save profile", "settings-profile-save");
  const note = document.createElement("span");
  note.className = "hint settings-profile-note";
  note.hidden = true;
  actions.append(save, note);

  save.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    setFormError(formError, "");
    note.hidden = true;

    if (!name) {
      setFormError(formError, "Give the profile a name");
      return;
    }
    if (!url) {
      setFormError(formError, "Enter the dashboard URL");
      return;
    }

    const externalOrigins = originsInput.value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    setBusy(save, true, "Saving…");
    try {
      const updated = await api().updateProfile(profile.id, {
        name,
        dashboard_url: url,
        allow_external: externalInput.checked,
        external_origins: externalOrigins,
      });
      profile.name = updated.name;
      profile.dashboard_url = updated.dashboard_url;
      profile.allow_external = updated.allow_external;
      profile.external_origins = updated.external_origins;
      status = await api().getStatus();
      note.textContent = "Saved.";
      note.hidden = false;
    } catch (error) {
      setFormError(formError, message(error));
    } finally {
      setBusy(save, false);
    }
  });

  card.append(nameField, urlField, externalBlock, formError, actions);
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
  const passwordConfirm = setupPasswordConfirm.value;

  if (!name) {
    setFormError(setupError, "Give the profile a name");
    return;
  }
  if (!config) {
    setFormError(setupError, "Choose a WireGuard config file or paste its contents");
    return;
  }
  if (!url) {
    setFormError(setupError, "Enter the dashboard URL");
    return;
  }
  if (wantsPassword && !password) {
    setFormError(setupError, "Enter a password, or turn the app lock off");
    return;
  }
  if (wantsPassword && password !== passwordConfirm) {
    setFormError(setupError, "Passwords do not match");
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
    setupPasswordConfirmField.hidden = true;
    setupPasswordHint.hidden = true;
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
    setFormError(addError, "Give the profile a name");
    return;
  }
  if (!config) {
    setFormError(addError, "Choose a WireGuard config file or paste its contents");
    return;
  }
  if (!url) {
    setFormError(addError, "Enter the dashboard URL");
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

async function submitSettingsPassword(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!status) {
    return;
  }
  setFormError(settingsPasswordError, "");
  settingsPasswordNote.hidden = true;

  const current = settingsOldPassword.value;
  const next = settingsNewPassword.value;
  const confirm = settingsNewPasswordConfirm.value;

  if (status.password_protected && !current) {
    setFormError(settingsPasswordError, "Enter your current password");
    return;
  }
  if (!next) {
    setFormError(settingsPasswordError, "Enter a new password");
    return;
  }
  if (next !== confirm) {
    setFormError(settingsPasswordError, "Passwords do not match");
    return;
  }

  const turningOn = !status.password_protected;
  let changed = false;
  setBusy(settingsPasswordSubmit, true, turningOn ? "Turning on…" : "Changing…");
  try {
    await api().changePassword(status.password_protected ? current : "", next);
    status = await api().getStatus();
    changed = true;
  } catch (error) {
    setFormError(settingsPasswordError, message(error));
  } finally {
    setBusy(settingsPasswordSubmit, false);
  }

  if (!changed) {
    return;
  }
  renderSettings();
  settingsPasswordNote.textContent = turningOn
    ? "App lock is on. The vault now needs this password after a restart."
    : "Password changed.";
  settingsPasswordNote.hidden = false;
}

async function removeAppLock(): Promise<void> {
  if (!status?.password_protected) {
    return;
  }
  setFormError(settingsPasswordError, "");
  settingsPasswordNote.hidden = true;

  const current = settingsOldPassword.value;
  if (!current) {
    setFormError(settingsPasswordError, "Enter your current password first");
    return;
  }
  if (
    !window.confirm(
      "Turn off the app lock? The vault key will be stored in a 0600 file in the app data folder.",
    )
  ) {
    return;
  }

  let changed = false;
  setBusy(settingsPasswordRemove, true, "Turning off…");
  try {
    await api().changePassword(current, "");
    status = await api().getStatus();
    changed = true;
  } catch (error) {
    setFormError(settingsPasswordError, message(error));
  } finally {
    setBusy(settingsPasswordRemove, false);
  }

  if (!changed) {
    return;
  }
  renderSettings();
  settingsPasswordNote.textContent =
    "App lock is off. The vault opens with its key file.";
  settingsPasswordNote.hidden = false;
}

function setPasswordHint(target: HTMLElement, length: number): void {
  if (length === 0) {
    target.hidden = true;
    target.textContent = "";
    return;
  }

  target.hidden = false;
  if (length < 8) {
    target.textContent = "Weak. Fine for a casual lock, not for a stolen device.";
  } else if (length < 12) {
    target.textContent = "Okay. Longer is better.";
  } else {
    target.textContent = "Good.";
  }
}

function updatePasswordHint(): void {
  setPasswordHint(setupPasswordHint, setupLock.checked ? setupPassword.value.length : 0);
}

setupLock.addEventListener("change", () => {
  setupPasswordField.hidden = !setupLock.checked;
  setupPasswordConfirmField.hidden = !setupLock.checked;
  if (!setupLock.checked) {
    setupPassword.value = "";
    setupPasswordConfirm.value = "";
  }
  updatePasswordHint();
});

setupPassword.addEventListener("input", updatePasswordHint);

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

navDashboards.addEventListener("click", () => {
  showMain();
});

settingsToggle.addEventListener("click", () => {
  showSettings();
});

settingsBack.addEventListener("click", () => {
  showMain();
});

settingsPasswordForm.addEventListener("submit", (event) => {
  void submitSettingsPassword(event);
});

settingsPasswordRemove.addEventListener("click", () => {
  void removeAppLock();
});

settingsNewPassword.addEventListener("input", () => {
  setPasswordHint(settingsPasswordHint, settingsNewPassword.value.length);
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
  bridge
    .version()
    .then((version) => {
      appVersion.textContent = `v${version}`;
    })
    .catch(() => undefined);
  bridge.onStatusChanged(() => {
    void refresh();
  });
  void refresh();
} else {
  showError("The desktop bridge did not load");
}
