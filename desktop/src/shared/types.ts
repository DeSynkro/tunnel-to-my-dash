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

export interface CredentialSummary {
  id: string;
  name: string;
  url?: string;
  username?: string;
}

export interface CredentialInput {
  name: string;
  url?: string;
  username?: string;
  password: string;
}

export interface CredentialSecret {
  username: string;
  password: string;
}

export type CredentialField = "username" | "password";

export interface ToolbarCredentialsState {
  credentials: CredentialSummary[];
}

export interface ToolbarPanelState {
  open: boolean;
}

export interface LoginCandidate {
  url: string;
  page: string;
  title: string;
  username: string;
  password: string;
}

export interface AutofillRequest {
  id: string;
  username: string;
  password: string;
}

export interface AutofillResult {
  ok: boolean;
  username: boolean;
  password: boolean;
}

export interface InlineFillAvailability {
  available: boolean;
  name?: string;
}

export interface InlineFillResult {
  ok: boolean;
  username?: string;
  password?: string;
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
  onCredentials(callback: (state: ToolbarCredentialsState) => void): () => void;
  onPanelState(callback: (state: ToolbarPanelState) => void): () => void;
  copyCredential(credentialID: string, field: CredentialField): Promise<void>;
  fillCredential(credentialID: string): Promise<void>;
  deleteCredential(credentialID: string): Promise<void>;
  openPanel(height: number): Promise<void>;
  closePanel(): Promise<void>;
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
  listCredentials(profileID: string): Promise<CredentialSummary[]>;
  addCredential(profileID: string, input: CredentialInput): Promise<CredentialSummary>;
  updateCredential(
    profileID: string,
    credentialID: string,
    input: CredentialInput,
  ): Promise<CredentialSummary>;
  deleteCredential(profileID: string, credentialID: string): Promise<void>;
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
