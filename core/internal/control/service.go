package control

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"sync"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/external"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/vault"
)

type ProfileInput struct {
	Name            string   `json:"name"`
	TunnelConfig    string   `json:"tunnel_config,omitempty"`
	DashboardURL    string   `json:"dashboard_url"`
	AllowExternal   bool     `json:"allow_external"`
	ExternalMode    string   `json:"external_mode,omitempty"`
	ExternalOrigins []string `json:"external_origins,omitempty"`
}

type ProfileSummary struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	DashboardURL    string   `json:"dashboard_url"`
	AllowExternal   bool     `json:"allow_external"`
	ExternalMode    string   `json:"external_mode,omitempty"`
	ExternalOrigins []string `json:"external_origins,omitempty"`
}

type Status struct {
	HasVault          bool             `json:"has_vault"`
	Locked            bool             `json:"locked"`
	PasswordProtected bool             `json:"password_protected"`
	Error             string           `json:"error,omitempty"`
	Profiles          []ProfileSummary `json:"profiles"`
	ActiveProfile     string           `json:"active_profile,omitempty"`
	Connected         bool             `json:"connected"`
	Proxy             string           `json:"proxy,omitempty"`
	DashboardURL      string           `json:"dashboard_url,omitempty"`
}

type Service struct {
	vaultPath string
	connector Connector

	mu           sync.Mutex
	store        *vault.Store
	hasVault     bool
	openErr      string
	connected    bool
	proxy        string
	dashboardURL string
}

func New(vaultPath string, connector Connector) (*Service, error) {
	s := &Service{
		vaultPath: vaultPath,
		connector: connector,
	}

	_, err := os.Stat(vaultPath)
	switch {
	case err == nil:
		s.hasVault = true
		store, openErr := vault.Open(vaultPath)
		if openErr != nil {
			s.openErr = openErr.Error()
		} else {
			s.store = store
		}
	case os.IsNotExist(err):
	default:
		return nil, err
	}

	return s, nil
}

func (s *Service) statusLocked() Status {
	st := Status{
		HasVault:     s.hasVault,
		Locked:       true,
		Error:        s.openErr,
		Profiles:     []ProfileSummary{},
		Connected:    s.connected,
		Proxy:        s.proxy,
		DashboardURL: s.dashboardURL,
	}

	if s.store != nil {
		st.Locked = !s.store.Unlocked()
		st.PasswordProtected = s.store.PasswordProtected()
		if !st.Locked {
			for _, p := range s.store.Profiles() {
				st.Profiles = append(st.Profiles, summarize(p))
			}
			if active, ok := s.store.ActiveProfile(); ok {
				st.ActiveProfile = active.ID
			}
		}
	}
	return st
}

func (s *Service) createVault(password string) error {
	if s.hasVault {
		return vault.ErrExists
	}

	store, err := vault.Create(s.vaultPath, password)
	if err != nil {
		return err
	}
	s.store = store
	s.hasVault = true
	s.openErr = ""
	return nil
}

func (s *Service) unlock(password string) error {
	if s.store == nil {
		return vault.ErrLocked
	}
	if err := s.store.Unlock(password); err != nil {
		return err
	}
	s.openErr = ""
	return nil
}

func (s *Service) lock() {
	_ = s.disconnectLocked()
	if s.store != nil {
		s.store.Lock()
	}
}

func (s *Service) changePassword(oldPassword, newPassword string) error {
	if err := s.requireUnlocked(); err != nil {
		return err
	}
	return s.store.ChangePassword(oldPassword, newPassword)
}

func (s *Service) addProfile(input ProfileInput) (ProfileSummary, error) {
	if err := s.requireUnlocked(); err != nil {
		return ProfileSummary{}, err
	}

	mode, err := normalizeMode(input.ExternalMode, input.AllowExternal)
	if err != nil {
		return ProfileSummary{}, err
	}
	origins, err := normalizeOrigins(input.ExternalOrigins)
	if err != nil {
		return ProfileSummary{}, err
	}
	profile, err := s.store.AddProfile(vault.Profile{
		Name:            input.Name,
		TunnelConfig:    input.TunnelConfig,
		DashboardURL:    input.DashboardURL,
		AllowExternal:   mode != external.ModeOff,
		ExternalMode:    mode,
		ExternalOrigins: origins,
	})
	if err != nil {
		return ProfileSummary{}, err
	}
	return summarize(profile), nil
}

func (s *Service) updateProfile(id string, input ProfileInput) (ProfileSummary, error) {
	if err := s.requireUnlocked(); err != nil {
		return ProfileSummary{}, err
	}

	profile, ok := s.store.Profile(id)
	if !ok {
		return ProfileSummary{}, vault.ErrProfileNotFound
	}
	mode, err := normalizeMode(input.ExternalMode, input.AllowExternal)
	if err != nil {
		return ProfileSummary{}, err
	}
	origins, err := normalizeOrigins(input.ExternalOrigins)
	if err != nil {
		return ProfileSummary{}, err
	}
	if input.Name != "" {
		profile.Name = input.Name
	}
	if input.DashboardURL != "" {
		profile.DashboardURL = input.DashboardURL
	}
	if input.TunnelConfig != "" {
		profile.TunnelConfig = input.TunnelConfig
	}
	profile.AllowExternal = mode != external.ModeOff
	profile.ExternalMode = mode
	profile.ExternalOrigins = origins

	if err := s.store.UpdateProfile(profile); err != nil {
		return ProfileSummary{}, err
	}
	return summarize(profile), nil
}

func (s *Service) deleteProfile(id string) error {
	if err := s.requireUnlocked(); err != nil {
		return err
	}

	if s.connected {
		if active, ok := s.store.ActiveProfile(); ok && active.ID == id {
			_ = s.disconnectLocked()
		}
	}
	return s.store.DeleteProfile(id)
}

func (s *Service) activateProfile(id string) error {
	if err := s.requireUnlocked(); err != nil {
		return err
	}
	return s.store.SetActiveProfile(id)
}

func (s *Service) connect(id string) (string, string, error) {
	if err := s.requireUnlocked(); err != nil {
		return "", "", err
	}

	profile, ok := s.store.Profile(id)
	if !ok {
		return "", "", vault.ErrProfileNotFound
	}
	tunnelCfg, err := config.ParseTunnel(profile.TunnelConfig)
	if err != nil {
		return "", "", fmt.Errorf("tunnel config: %w", err)
	}

	_ = s.disconnectLocked()
	proxy, err := s.connector.Connect(ConnectOptions{
		Tunnel:          tunnelCfg,
		AllowExternal:   profile.AllowExternal,
		ExternalMode:    profile.EffectiveExternalMode(),
		ExternalOrigins: profile.ExternalOrigins,
	})
	if err != nil {
		return "", "", err
	}
	if err := s.store.SetActiveProfile(id); err != nil {
		_ = s.connector.Disconnect()
		return "", "", err
	}

	s.connected = true
	s.proxy = proxy
	s.dashboardURL = profile.DashboardURL
	return proxy, profile.DashboardURL, nil
}

// probeTarget prepares a reachability check while the service lock is held.
// The caller releases the lock before dialing so a slow probe never blocks
// settings or profile changes.
func (s *Service) probeTarget(id string) (ConnectOptions, string, error) {
	if err := s.requireUnlocked(); err != nil {
		return ConnectOptions{}, "", err
	}

	profile, ok := s.store.Profile(id)
	if !ok {
		return ConnectOptions{}, "", vault.ErrProfileNotFound
	}
	tunnelCfg, err := config.ParseTunnel(profile.TunnelConfig)
	if err != nil {
		return ConnectOptions{}, "", fmt.Errorf("tunnel config: %w", err)
	}
	address, err := dashboardAddress(profile.DashboardURL)
	if err != nil {
		return ConnectOptions{}, "", fmt.Errorf("dashboard URL: %w", err)
	}

	return ConnectOptions{
		Tunnel:          tunnelCfg,
		AllowExternal:   profile.AllowExternal,
		ExternalMode:    profile.EffectiveExternalMode(),
		ExternalOrigins: profile.ExternalOrigins,
	}, address, nil
}

func dashboardAddress(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	host := parsed.Hostname()
	if host == "" {
		return "", fmt.Errorf("dashboard URL has no host")
	}
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	return net.JoinHostPort(host, port), nil
}

func (s *Service) disconnect() error {
	return s.disconnectLocked()
}

func (s *Service) disconnectLocked() error {
	var err error
	if s.connector != nil {
		err = s.connector.Disconnect()
	}
	s.connected = false
	s.proxy = ""
	s.dashboardURL = ""
	return err
}

func (s *Service) requireUnlocked() error {
	if s.store == nil || !s.store.Unlocked() {
		return vault.ErrLocked
	}
	return nil
}

func (s *Service) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.disconnectLocked()
	if s.store != nil {
		s.store.Lock()
	}
}

func normalizeMode(mode string, allowExternal bool) (string, error) {
	normalized, err := external.NormalizeMode(mode, allowExternal)
	if err != nil {
		return "", fmt.Errorf("%w: %v", vault.ErrInvalidProfile, err)
	}
	return normalized, nil
}

func normalizeOrigins(raw []string) ([]string, error) {
	origins, err := external.ParseAll(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", vault.ErrInvalidProfile, err)
	}
	return external.Strings(origins), nil
}

func summarize(p vault.Profile) ProfileSummary {
	return ProfileSummary{
		ID:              p.ID,
		Name:            p.Name,
		DashboardURL:    p.DashboardURL,
		AllowExternal:   p.AllowExternal,
		ExternalMode:    p.EffectiveExternalMode(),
		ExternalOrigins: append([]string(nil), p.ExternalOrigins...),
	}
}
