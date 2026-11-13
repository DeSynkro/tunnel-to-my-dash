package mobile

// VaultStatus is the small JSON view returned to the Android shell.
type VaultStatus struct {
	HasVault          bool `json:"has_vault"`
	Locked            bool `json:"locked"`
	PasswordProtected bool `json:"password_protected"`
}

// ProfileSummary is the non-secret profile view used by the list screen.
type ProfileSummary struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	DashboardURL string `json:"dashboard_url"`
	ExternalMode string `json:"external_mode"`
	Active       bool   `json:"active"`
}

// ProfileDetail is the non-secret profile view used by the editor. The tunnel
// config and saved credentials never cross this boundary.
type ProfileDetail struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	DashboardURL    string   `json:"dashboard_url"`
	ExternalMode    string   `json:"external_mode"`
	ExternalOrigins []string `json:"external_origins"`
	HasTunnelConfig bool     `json:"has_tunnel_config"`
}

// ProfileInput is the editable profile data. An empty TunnelConfig on update
// keeps the stored config; credentials are always preserved by the bridge.
type ProfileInput struct {
	ID              string   `json:"id,omitempty"`
	Name            string   `json:"name"`
	TunnelConfig    string   `json:"tunnel_config,omitempty"`
	DashboardURL    string   `json:"dashboard_url"`
	ExternalMode    string   `json:"external_mode"`
	ExternalOrigins []string `json:"external_origins,omitempty"`
}

// Settings combines the shared LAN policy with the Android-only preferences.
type Settings struct {
	ForceLANOnly             bool `json:"force_lan_only"`
	LockOnBackground         bool `json:"lock_on_background"`
	AutoConnect              bool `json:"auto_connect"`
	OpenPublicLinksInBrowser bool `json:"open_public_links_in_browser"`
}

// ConnectionInfo is returned by StartProfile for the foreground service and
// WebView.
type ConnectionInfo struct {
	Proxy        string `json:"proxy"`
	DashboardURL string `json:"dashboard_url"`
	ProfileID    string `json:"profile_id"`
	ProfileName  string `json:"profile_name"`
}
