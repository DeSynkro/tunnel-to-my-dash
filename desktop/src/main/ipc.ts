import { app, dialog, ipcMain, type BrowserWindow, type OpenDialogOptions } from "electron";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ControlClient } from "./control-client";
import type { SettingsStore } from "./settings";
import { IPC } from "../shared/ipc";
import type { AppSettings, ConnectResult, ProfileInput } from "../shared/types";

export interface NavigationActions {
  back(): void;
  forward(): void;
  reload(): void;
  home(): void;
  backToApp(): void;
}

export interface IpcOptions {
  control: ControlClient | null;
  coreError: string | null;
  getWindow: () => BrowserWindow | null;
  navigation: NavigationActions;
  settings: SettingsStore;
  openDashboard: (profileID: string, result: ConnectResult) => Promise<void>;
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

  ipcMain.handle(IPC.status, () => control().status());
  ipcMain.handle(IPC.createVault, (_event, password: unknown) => control().createVault(stringArg(password)));
  ipcMain.handle(IPC.unlock, (_event, password: unknown) => control().unlock(stringArg(password)));
  ipcMain.handle(IPC.lock, () => control().lock());
  ipcMain.handle(IPC.changePassword, (_event, oldPassword: unknown, newPassword: unknown) =>
    control().changePassword(stringArg(oldPassword), stringArg(newPassword)),
  );
  ipcMain.handle(IPC.addProfile, (_event, input: ProfileInput) => control().addProfile(input));
  ipcMain.handle(IPC.updateProfile, (_event, id: unknown, input: ProfileInput) =>
    control().updateProfile(stringArg(id), input),
  );
  ipcMain.handle(IPC.deleteProfile, (_event, id: unknown) => control().deleteProfile(stringArg(id)));
  ipcMain.handle(IPC.activateProfile, (_event, id: unknown) => control().activateProfile(stringArg(id)));
  ipcMain.handle(IPC.checkProfile, (_event, id: unknown) => control().checkProfile(stringArg(id)));
  ipcMain.handle(IPC.connect, async (_event, id: unknown) => {
    const profileID = stringArg(id);
    const result = await control().connect(profileID);
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
  ipcMain.handle(IPC.disconnect, () => control().disconnect());

  ipcMain.handle(IPC.getSettings, () => options.settings.get());
  ipcMain.handle(IPC.updateSettings, (_event, patch: unknown) =>
    options.settings.update(settingsPatch(patch)),
  );

  ipcMain.handle(IPC.chooseConfig, async () => {
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

  ipcMain.handle(IPC.navBack, () => options.navigation.back());
  ipcMain.handle(IPC.navForward, () => options.navigation.forward());
  ipcMain.handle(IPC.navReload, () => options.navigation.reload());
  ipcMain.handle(IPC.navHome, () => options.navigation.home());
  ipcMain.handle(IPC.navBackToApp, () => options.navigation.backToApp());

  ipcMain.handle(IPC.quit, () => {
    app.quit();
  });

  ipcMain.handle(IPC.version, () => app.getVersion());
}

function stringArg(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid request.");
  }
  return value;
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
  return patch;
}
