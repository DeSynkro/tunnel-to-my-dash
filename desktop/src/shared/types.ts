export type ExternalMode = "off" | "all" | "origins";

export interface AppSettings {
  open_last_dashboard: boolean;
  auto_hide_toolbar: boolean;
}

export interface PointerPayload {
  y: number;
  out: boolean;
}

export interface SecuritySettings {
  force_lan_only: boolean;
  lock_after_idle: boolean;
  idle_minutes: number;
}

export interface ProfileSummary {
  id: string;
  name: string;
  dashboard_url: string;
  allow_external: boolean;
  external_mode?: ExternalMode;
  external_origins?: string[];
}

export interface ProfileInput {
  name: string;
  tunnel_config?: string;
  dashboard_url: string;
  allow_external: boolean;
  external_mode?: ExternalMode;
  external_origins?: string[];
}

export interface Status {
  has_vault: boolean;
  locked: boolean;
  password_protected: boolean;
  error?: string;
  profiles: ProfileSummary[];
  active_profile?: string;
  connected: boolean;
  proxy?: string;
  dashboard_url?: string;
  security: SecuritySettings;
}

export interface ConnectResult {
  proxy: string;
  dashboard_url: string;
}

export interface CheckResult {
  reachable: boolean;
}

export interface ConfigFile {
  name: string;
  text: string;
}

export type ToolbarMode = "fixed" | "floating" | "peek";

export interface NavState {
  canGoBack: boolean;
  canGoForward: boolean;
  url: string;
  passwordProtected: boolean;
  mode: ToolbarMode;
}

export interface NavigationBridge {
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  home(): Promise<void>;
  backToApp(): Promise<void>;
  lock(): Promise<void>;
  onState(callback: (state: NavState) => void): () => void;
}

export interface LockBridge {
  unlock(password: string): Promise<void>;
  backToApp(): Promise<void>;
  quit(): Promise<void>;
  onShown(callback: (snapshot: string) => void): () => void;
}

export interface TtmdBridge {
  getStatus(): Promise<Status>;
  createVault(password: string): Promise<Status>;
  unlock(password: string): Promise<Status>;
  lock(): Promise<Status>;
  changePassword(oldPassword: string, newPassword: string): Promise<Status>;
  addProfile(input: ProfileInput): Promise<ProfileSummary>;
  updateProfile(id: string, input: ProfileInput): Promise<ProfileSummary>;
  deleteProfile(id: string): Promise<void>;
  activateProfile(id: string): Promise<Status>;
  checkProfile(id: string): Promise<CheckResult>;
  connect(id: string): Promise<ConnectResult>;
  disconnect(): Promise<Status>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  updateSecurity(settings: SecuritySettings): Promise<Status>;
  chooseConfig(): Promise<ConfigFile | null>;
  onStatusChanged(callback: () => void): () => void;
  onSuppressAutoOpen(callback: () => void): () => void;
  quit(): Promise<void>;
  version(): Promise<string>;
}
