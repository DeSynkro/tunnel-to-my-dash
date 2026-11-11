import type {
  AppSettings,
  ConfigFile,
  ExternalMode,
  ProfileInput,
  ProfileSummary,
  SecuritySettings,
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
  profile: element<HTMLElement>("screen-profile"),
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

const profileForm = element<HTMLFormElement>("profile-form");
const profileName = element<HTMLInputElement>("profile-name");
const profileURL = element<HTMLInputElement>("profile-url");
const profileExternalOff = element<HTMLInputElement>("profile-external-off");
const profileExternalAll = element<HTMLInputElement>("profile-external-all");
const profileExternalOrigins = element<HTMLInputElement>("profile-external-origins");
const profileOriginsField = element<HTMLElement>("profile-origins-field");
const profileOrigins = element<HTMLTextAreaElement>("profile-origins");
const profileError = element<HTMLElement>("profile-error");
const profileSave = element<HTMLButtonElement>("profile-save");
const profileBack = element<HTMLButtonElement>("profile-back");
const profileCancel = element<HTMLButtonElement>("profile-cancel");

const settingsOpenLast = element<HTMLInputElement>("settings-open-last");
const settingsBehaviorError = element<HTMLElement>("settings-behavior-error");
const settingsForceLan = element<HTMLInputElement>("settings-force-lan");
const settingsIdleLock = element<HTMLInputElement>("settings-idle-lock");
const settingsIdleMinutes = element<HTMLSelectElement>("settings-idle-minutes");
const settingsIdleMinutesField = element<HTMLElement>("settings-idle-minutes-field");
const settingsIdleHint = element<HTMLElement>("settings-idle-hint");
const settingsSecurityError = element<HTMLElement>("settings-security-error");
const profileExternalOverride = element<HTMLElement>("profile-external-override");
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
let editingProfileID: string | null = null;
const reachability: Record<string, boolean> = {};
let reachabilityChecking: string | null = null;
let autoChecked = false;
let appSettings: AppSettings = { open_last_dashboard: false };

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

  const appLayout = name === "main" || name === "profile" || name === "settings";
  const dashboardsActive = name === "main" || name === "profile";
  rail.hidden = !appLayout;
  document.body.classList.toggle("layout-app", appLayout);
  navDashboards.classList.toggle("active", dashboardsActive);
  settingsToggle.classList.toggle("active", name === "settings");
  if (dashboardsActive) {
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

async function refresh(autoOpen = false): Promise<void> {
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
      editingProfileID = null;
      showScreen("lock");
      lockPassword.focus();
      return;
    }
    if (settingsOpen) {
      showSettings();
    } else if (editingProfileID && status.profiles.some((p) => p.id === editingProfileID)) {
      showProfile(editingProfileID);
    } else {
      showMain(autoOpen);
      if (autoOpen) {
        void autoOpenLastDashboard();
      }
    }
  } catch (error) {
    showError(message(error));
  }
}

function showMain(autoOpen = false): void {
  if (!status) {
    return;
  }

  settingsOpen = false;
  editingProfileID = null;
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

  const willAutoOpen = autoOpen && appSettings.open_last_dashboard;
  if (!autoChecked && status.active_profile && !willAutoOpen) {
    autoChecked = true;
    void checkReachability(status.active_profile);
  }
}

async function autoOpenLastDashboard(): Promise<void> {
  if (!appSettings.open_last_dashboard || !status || status.locked) {
    return;
  }
  const profileID = status.active_profile;
  if (!profileID || !status.profiles.some((profile) => profile.id === profileID)) {
    return;
  }

  try {
    await api().connect(profileID);
  } catch (error) {
    mainNote.textContent = message(error);
    void checkReachability(profileID);
  }
}

function externalModeLabel(profile: ProfileSummary): string {
  if (status?.security?.force_lan_only) {
    return "LAN only (app override)";
  }

  const mode: ExternalMode =
    profile.external_mode ?? (profile.allow_external ? "origins" : "off");
  if (mode === "all") {
    return "External: all";
  }
  if (mode === "origins") {
    const count = profile.external_origins?.length ?? 0;
    return count === 1 ? "External: 1 origin" : `External: ${count} origins`;
  }
  return "LAN only";
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

  const reachable = reachability[profile.id];
  const dotButton = document.createElement("button");
  dotButton.type = "button";
  dotButton.className = "dot-button";
  dotButton.title =
    reachable === true
      ? "Reachable"
      : reachable === false
        ? "Not reachable"
        : "Check reachability";
  dotButton.setAttribute("aria-label", `Check reachability for ${profile.name}`);
  dotButton.disabled = reachabilityChecking !== null;
  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.classList.toggle("on", reachable === true);
  dot.classList.toggle("bad", reachable === false);
  dotButton.append(dot);
  dotButton.addEventListener("click", () => {
    void checkReachability(profile.id);
  });
  head.append(dotButton);

  const title = document.createElement("h3");
  title.textContent = profile.name;
  head.append(title);

  const url = document.createElement("p");
  url.className = "profile-url";
  url.textContent = profile.dashboard_url;

  const mode = document.createElement("p");
  mode.className = "profile-mode";
  mode.textContent = externalModeLabel(profile);

  main.append(head, url, mode);

  const actions = document.createElement("div");
  actions.className = "profile-actions";

  const connect = makeButton("Open dashboard");
  connect.addEventListener("click", () => {
    void openProfile(profile.id, connect);
  });
  actions.append(connect);

  const edit = makeButton("Edit", "ghost profile-edit");
  edit.addEventListener("click", () => {
    showProfile(profile.id);
  });
  actions.append(edit);

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

async function openProfile(profileID: string, button?: HTMLButtonElement): Promise<void> {
  if (button) {
    setBusy(button, true, "Opening…");
  }
  try {
    await api().connect(profileID);
  } catch (error) {
    mainNote.textContent = message(error);
    if (button) {
      setBusy(button, false);
    }
  }
}

function showSettings(): void {
  if (!status || status.locked) {
    return;
  }
  settingsOpen = true;
  editingProfileID = null;
  renderSettings();
  renderRail();
  showScreen("settings");
}

function renderSettings(): void {
  if (!status) {
    return;
  }

  settingsLockState.textContent = status.password_protected
    ? "App lock is on. The vault needs your password after a restart."
    : "App lock is off. The vault opens with a 0600 key file in the app data folder.";
  settingsOldPasswordField.hidden = !status.password_protected;
  settingsPasswordRemove.hidden = !status.password_protected;
  settingsPasswordSubmit.textContent = status.password_protected
    ? "Change password"
    : "Turn on app lock";

  settingsOpenLast.checked = appSettings.open_last_dashboard;
  setFormError(settingsBehaviorError, "");
  renderSecuritySettings();

  settingsPasswordForm.reset();
  setFormError(settingsPasswordError, "");
  settingsPasswordNote.hidden = true;
  settingsPasswordHint.hidden = true;
  settingsPasswordHint.textContent = "";
}

async function checkReachability(profileID: string): Promise<void> {
  if (reachabilityChecking) {
    return;
  }

  reachabilityChecking = profileID;
  if (document.body.dataset.screen === "main" && status) {
    profileList.replaceChildren(...status.profiles.map((profile) => profileCard(profile)));
  }

  try {
    const result = await api().checkProfile(profileID);
    reachability[profileID] = result.reachable;
  } catch (error) {
    delete reachability[profileID];
    mainNote.textContent = message(error);
  } finally {
    reachabilityChecking = null;
  }

  if (document.body.dataset.screen === "main" && status) {
    profileList.replaceChildren(...status.profiles.map((profile) => profileCard(profile)));
  }
}

function renderSecuritySettings(): void {
  const security: SecuritySettings = status?.security ?? {
    force_lan_only: false,
    lock_after_idle: false,
    idle_minutes: 15,
  };
  const passwordProtected = status?.password_protected ?? false;

  settingsForceLan.checked = security.force_lan_only;
  settingsIdleLock.checked = security.lock_after_idle;
  settingsIdleMinutes.value = String(security.idle_minutes || 15);
  settingsIdleMinutesField.hidden = !security.lock_after_idle;
  settingsIdleLock.disabled = !passwordProtected;
  settingsIdleMinutes.disabled = !passwordProtected || !security.lock_after_idle;
  settingsIdleHint.textContent = passwordProtected
    ? "Locks the vault after a period without input."
    : "Set an app password first.";
  setFormError(settingsSecurityError, "");
}

async function applySecurity(patch: Partial<SecuritySettings>): Promise<void> {
  if (!status) {
    return;
  }

  const current: SecuritySettings = status.security ?? {
    force_lan_only: false,
    lock_after_idle: false,
    idle_minutes: 15,
  };
  const next: SecuritySettings = { ...current, ...patch };
  try {
    status = await api().updateSecurity(next);
  } catch (error) {
    setFormError(settingsSecurityError, message(error));
  } finally {
    renderSecuritySettings();
  }
}

function showProfile(profileID: string): void {
  const profile = status?.profiles.find((p) => p.id === profileID);
  if (!status || !profile) {
    return;
  }

  editingProfileID = profileID;
  settingsOpen = false;

  profileName.value = profile.name;
  profileURL.value = profile.dashboard_url;
  const mode: ExternalMode =
    profile.external_mode ?? (profile.allow_external ? "origins" : "off");
  profileExternalOff.checked = mode === "off";
  profileExternalAll.checked = mode === "all";
  profileExternalOrigins.checked = mode === "origins";
  profileOrigins.value = (profile.external_origins ?? []).join("\n");
  updateProfileOriginsVisibility();

  const override = status.security?.force_lan_only === true;
  profileExternalOverride.hidden = !override;
  const options = profileExternalOff.closest("fieldset");
  if (options instanceof HTMLFieldSetElement) {
    options.disabled = override;
    options.title = override ? "Force LAN-only is on in Settings" : "";
    for (const control of options.querySelectorAll("input, textarea")) {
      (control as HTMLInputElement | HTMLTextAreaElement).disabled = override;
    }
  }

  setFormError(profileError, "");

  renderRail();
  showScreen("profile");
}

function updateProfileOriginsVisibility(): void {
  profileOriginsField.hidden = !profileExternalOrigins.checked;
}

async function submitProfile(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!editingProfileID) {
    showMain();
    return;
  }

  setFormError(profileError, "");
  const name = profileName.value.trim();
  const url = profileURL.value.trim();
  const mode: ExternalMode = profileExternalAll.checked
    ? "all"
    : profileExternalOrigins.checked
      ? "origins"
      : "off";
  const origins = profileOrigins.value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!name) {
    setFormError(profileError, "Give the profile a name");
    return;
  }
  if (!url) {
    setFormError(profileError, "Enter the dashboard URL");
    return;
  }
  if (mode === "origins" && origins.length === 0) {
    setFormError(profileError, "Add at least one origin, or choose Allow all");
    return;
  }

  setBusy(profileSave, true, "Saving…");
  try {
    delete reachability[editingProfileID];
    await api().updateProfile(editingProfileID, {
      name,
      dashboard_url: url,
      allow_external: mode !== "off",
      external_mode: mode,
      external_origins: origins,
    });
    status = await api().getStatus();
    editingProfileID = null;
    showMain();
  } catch (error) {
    setFormError(profileError, message(error));
  } finally {
    setBusy(profileSave, false);
  }
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
    await refresh(true);
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

profileForm.addEventListener("submit", (event) => {
  void submitProfile(event);
});

profileBack.addEventListener("click", () => {
  showMain();
});

profileCancel.addEventListener("click", () => {
  showMain();
});

profileExternalOff.addEventListener("change", updateProfileOriginsVisibility);
profileExternalAll.addEventListener("change", updateProfileOriginsVisibility);
profileExternalOrigins.addEventListener("change", updateProfileOriginsVisibility);

settingsToggle.addEventListener("click", () => {
  showSettings();
});

settingsForceLan.addEventListener("change", () => {
  void applySecurity({ force_lan_only: settingsForceLan.checked });
});

settingsIdleLock.addEventListener("change", () => {
  void applySecurity({ lock_after_idle: settingsIdleLock.checked });
});

settingsIdleMinutes.addEventListener("change", () => {
  void applySecurity({ idle_minutes: Number(settingsIdleMinutes.value) });
});

settingsOpenLast.addEventListener("change", async () => {
  const desired = settingsOpenLast.checked;
  setFormError(settingsBehaviorError, "");
  settingsOpenLast.disabled = true;
  try {
    appSettings = await api().updateSettings({ open_last_dashboard: desired });
    settingsOpenLast.checked = appSettings.open_last_dashboard;
  } catch (error) {
    settingsOpenLast.checked = appSettings.open_last_dashboard;
    setFormError(settingsBehaviorError, message(error));
  } finally {
    settingsOpenLast.disabled = false;
  }
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

async function init(): Promise<void> {
  try {
    appSettings = await api().getSettings();
  } catch {
    appSettings = { open_last_dashboard: false };
  }
  await refresh(true);
}

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
  void init();
} else {
  showError("The desktop bridge did not load");
}
