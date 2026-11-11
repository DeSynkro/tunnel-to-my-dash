package vault

type Profile struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	TunnelConfig    string   `json:"tunnel_config"`
	DashboardURL    string   `json:"dashboard_url"`
	AllowExternal   bool     `json:"allow_external"`
	ExternalOrigins []string `json:"external_origins,omitempty"`
}

type Data struct {
	Version       int       `json:"version"`
	ActiveProfile string    `json:"active_profile,omitempty"`
	Profiles      []Profile `json:"profiles"`
}
