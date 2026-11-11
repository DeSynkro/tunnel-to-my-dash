export type ExternalMode = "off" | "all" | "origins";

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

export interface NavState {
  canGoBack: boolean;
  canGoForward: boolean;
  url: string;
}

export interface NavigationBridge {
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  home(): Promise<void>;
  backToApp(): Promise<void>;
  onState(callback: (state: NavState) => void): () => void;
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
  chooseConfig(): Promise<ConfigFile | null>;
  onStatusChanged(callback: () => void): () => void;
  quit(): Promise<void>;
  version(): Promise<string>;
}
