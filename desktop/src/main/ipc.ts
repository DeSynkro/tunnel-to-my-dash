import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ControlClient } from "./control-client";
import type { SettingsStore } from "./settings";
import { IPC } from "../shared/ipc";
import type {
  AppSettings,
  ConnectResult,
  CredentialInput,
  ProfileInput,
  SecuritySettings,
  Status,
} from "../shared/types";

export interface NavigationActions {
  back(): void;
  forward(): void;
  reload(): void;
  home(): void;
  backToApp(): void;
  lock(): void;
}

export interface IpcOptions {
  control: ControlClient | null;
  coreError: string | null;
  getWindow: () => BrowserWindow | null;
  navigation: NavigationActions;
  settings: SettingsStore;
  lockVault: () => Promise<Status>;
  unlockDashboard: (password: string) => Promise<void>;
  openDashboard: (profileID: string, result: ConnectResult) => Promise<void>;
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}

export function registerIpc(options: IpcOptions): void {
  const control = (): ControlClient => {
    if (options.coreError) {
      throw new Error(options.coreError);
    }
    if (!options.control) {
      throw new Error("The core is not ready.");
    }
    return options.control;
  };

  const handle = <Args extends unknown[]>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: Args) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!options.isTrustedSender(event)) {
        throw new Error("Invalid request.");
      }
      return listener(event, ...(args as Args));
    });
  };

  handle(IPC.status, () => control().status());
  handle(IPC.createVault, (_event, password: unknown) => control().createVault(stringArg(password)));
  handle(IPC.unlock, (_event, password: unknown) => control().unlock(stringArg(password)));
  handle(IPC.lock, () => options.lockVault());
  handle(IPC.changePassword, (_event, oldPassword: unknown, newPassword: unknown) =>
    control().changePassword(stringArg(oldPassword), stringArg(newPassword)),
  );
  handle(IPC.addProfile, (_event, input: ProfileInput) => control().addProfile(input));
  handle(IPC.updateProfile, (_event, id: unknown, input: ProfileInput) =>
    control().updateProfile(stringArg(id), input),
  );
  handle(IPC.deleteProfile, (_event, id: unknown) => control().deleteProfile(stringArg(id)));
  handle(IPC.activateProfile, (_event, id: unknown) => control().activateProfile(stringArg(id)));
  handle(IPC.checkProfile, (_event, id: unknown) => control().checkProfile(stringArg(id)));
  handle(IPC.listCredentials, (_event, profileID: unknown) =>
    control().listCredentials(stringArg(profileID)),
  );
  handle(
    IPC.addCredential,
    (_event, profileID: unknown, input: CredentialInput) =>
      control().addCredential(stringArg(profileID), credentialArg(input)),
  );
  handle(
    IPC.updateCredential,
    (_event, profileID: unknown, credentialID: unknown, input: CredentialInput) =>
      control().updateCredential(
        stringArg(profileID),
        stringArg(credentialID),
        credentialArg(input),
      ),
  );
  handle(
    IPC.deleteCredential,
    (_event, profileID: unknown, credentialID: unknown) =>
      control().deleteCredential(stringArg(profileID), stringArg(credentialID)),
  );
  handle(IPC.connect, async (_event, id: unknown) => {
    const profileID = stringArg(id);
    const connectWithRetry = async (): Promise<ConnectResult> => {
      for (;;) {
        try {
          return await control().connect(profileID);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          const box = {
            type: "error" as const,
            buttons: ["Try again", "Cancel"],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
            title: "Could not open the dashboard",
            message: "The tunnel did not come up.",
            detail,
          };
          const window = options.getWindow();
          const choice = window
            ? await dialog.showMessageBox(window, box)
            : await dialog.showMessageBox(box);
          if (choice.response !== 0) {
            throw error;
          }
        }
      }
    };

    const result = await connectWithRetry();
    try {
      await options.openDashboard(profileID, result);
    } catch (error) {
      try {
        await control().disconnect();
      } catch {
        // The original error is the useful one.
      }
      throw error;
    }
    return result;
  });
  handle(IPC.disconnect, () => control().disconnect());

  handle(IPC.getSettings, () => options.settings.get());
  handle(IPC.updateSettings, (_event, patch: unknown) =>
    options.settings.update(settingsPatch(patch)),
  );
  handle(IPC.updateSecurity, (_event, settings: unknown) =>
    control().updateSecurity(securityArg(settings)),
  );

  handle(IPC.chooseConfig, async () => {
    const window = options.getWindow();
    const dialogOptions: OpenDialogOptions = {
      title: "Choose a WireGuard config",
      properties: ["openFile"],
      filters: [
        { name: "WireGuard config", extensions: ["conf", "wgconf", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    };

    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const info = await stat(filePath);
    if (info.size > 1024 * 1024) {
      throw new Error("That config file is too large.");
    }

    return {
      name: path.basename(filePath),
      text: await readFile(filePath, "utf8"),
    };
  });

  handle(IPC.navBack, () => options.navigation.back());
  handle(IPC.navForward, () => options.navigation.forward());
  handle(IPC.navReload, () => options.navigation.reload());
  handle(IPC.navHome, () => options.navigation.home());
  handle(IPC.navBackToApp, () => options.navigation.backToApp());
  handle(IPC.navLock, () => options.navigation.lock());
  handle(IPC.dashboardUnlock, (_event, password: unknown) =>
    options.unlockDashboard(stringArg(password)),
  );

  handle(IPC.quit, () => {
    app.quit();
  });

  handle(IPC.version, () => app.getVersion());
}

function stringArg(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid request.");
  }
  return value;
}

function credentialArg(value: unknown): CredentialInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid saved password");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== "string" || typeof raw.password !== "string") {
    throw new Error("Invalid saved password");
  }
  const input: CredentialInput = {
    name: raw.name,
    password: raw.password,
  };
  if (typeof raw.url === "string" && raw.url !== "") {
    input.url = raw.url;
  }
  if (typeof raw.username === "string" && raw.username !== "") {
    input.username = raw.username;
  }
  return input;
}

function securityArg(value: unknown): SecuritySettings {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid security settings");
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.force_lan_only !== "boolean" ||
    typeof raw.lock_after_idle !== "boolean" ||
    typeof raw.idle_minutes !== "number" ||
    typeof raw.require_https_external !== "boolean"
  ) {
    throw new Error("Invalid security settings");
  }
  return {
    force_lan_only: raw.force_lan_only,
    lock_after_idle: raw.lock_after_idle,
    idle_minutes: raw.idle_minutes,
    require_https_external: raw.require_https_external,
  };
}

function settingsPatch(value: unknown): Partial<AppSettings> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid settings");
  }
  const raw = value as Record<string, unknown>;
  const patch: Partial<AppSettings> = {};
  if ("open_last_dashboard" in raw) {
    if (typeof raw.open_last_dashboard !== "boolean") {
      throw new Error("Invalid settings");
    }
    patch.open_last_dashboard = raw.open_last_dashboard;
  }
  if ("auto_hide_toolbar" in raw) {
    if (typeof raw.auto_hide_toolbar !== "boolean") {
      throw new Error("Invalid settings");
    }
    patch.auto_hide_toolbar = raw.auto_hide_toolbar;
  }
  if ("open_external_links" in raw) {
    if (typeof raw.open_external_links !== "boolean") {
      throw new Error("Invalid settings");
    }
    patch.open_external_links = raw.open_external_links;
  }
  if ("open_links_in_new_window" in raw) {
    if (typeof raw.open_links_in_new_window !== "boolean") {
      throw new Error("Invalid settings");
    }
    patch.open_links_in_new_window = raw.open_links_in_new_window;
  }
  return patch;
}
