package mobile

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/external"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/nav"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/vault"
)

// VaultExists reports whether a vault file exists at path.
func VaultExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// CreateVault creates the vault and leaves it open. An empty password creates
// a keyfile vault.
func CreateVault(path, password string) error {
	mu.Lock()
	defer mu.Unlock()

	created, err := vault.Create(path, password)
	if err != nil {
		return err
	}
	if err := created.SetAndroidSettings(vault.DefaultAndroidSettings()); err != nil {
		return err
	}
	store = created
	storePath = path
	return nil
}

// OpenVault opens an existing vault. Password vaults stay locked until
// UnlockVault; keyfile vaults open unlocked. Reopening the vault that is
// already open is a no-op, so an activity restart does not discard an unlocked
// vault or its state.
func OpenVault(path string) error {
	mu.Lock()
	defer mu.Unlock()

	if store != nil && storePath == path {
		return nil
	}
	opened, err := vault.Open(path)
	if err != nil {
		return err
	}
	store = opened
	storePath = path
	return nil
}

// UnlockVault unlocks the currently open password vault.
func UnlockVault(password string) error {
	mu.Lock()
	defer mu.Unlock()

	if store == nil {
		return errors.New("no vault is open")
	}
	return store.Unlock(password)
}

// LockVault locks the currently open vault. The active tunnel is owned by the
// service and is stopped separately.
func LockVault() {
	mu.Lock()
	defer mu.Unlock()

	if store != nil && store.PasswordProtected() {
		store.Lock()
	}
}

// VaultStatusJSON reports whether a vault is open and whether it is locked.
func VaultStatusJSON() (string, error) {
	mu.Lock()
	defer mu.Unlock()

	status := VaultStatus{Locked: true}
	if store != nil {
		status.HasVault = true
		status.Locked = !store.Unlocked()
		status.PasswordProtected = store.PasswordProtected()
	}
	return marshal(status)
}

// ChangeVaultPassword changes the password of the open vault.
func ChangeVaultPassword(oldPassword, newPassword string) error {
	mu.Lock()
	defer mu.Unlock()

	if store == nil {
		return errors.New("no vault is open")
	}
	return store.ChangePassword(oldPassword, newPassword)
}

// VerifyVaultPassword checks a password against the open vault without
// changing its lock state.
func VerifyVaultPassword(password string) error {
	mu.Lock()
	defer mu.Unlock()

	if store == nil {
		return errors.New("no vault is open")
	}
	return store.VerifyPassword(password)
}

// ProfilesJSON returns the non-secret profile list.
func ProfilesJSON() (string, error) {
	mu.Lock()
	defer mu.Unlock()

	s, err := requireUnlocked()
	if err != nil {
		return "", err
	}
	profiles := s.Profiles()
	out := make([]ProfileSummary, 0, len(profiles))
	for _, profile := range profiles {
		out = append(out, profileSummary(s, profile))
	}
	return marshal(out)
}

// ProfileJSON returns the editable, non-secret profile detail.
func ProfileJSON(id string) (string, error) {
	mu.Lock()
	defer mu.Unlock()

	s, err := requireUnlocked()
	if err != nil {
		return "", err
	}
	profile, ok := s.Profile(id)
	if !ok {
		return "", vault.ErrProfileNotFound
	}
	return marshal(ProfileDetail{
		ID:              profile.ID,
		Name:            profile.Name,
		DashboardURL:    profile.DashboardURL,
		ExternalMode:    profile.EffectiveExternalMode(),
		ExternalOrigins: append([]string(nil), profile.ExternalOrigins...),
		HasTunnelConfig: strings.TrimSpace(profile.TunnelConfig) != "",
	})
}

// AddProfileJSON adds a profile from editable JSON and returns its summary.
func AddProfileJSON(input string) (string, error) {
	var profileInput ProfileInput
	if err := json.Unmarshal([]byte(input), &profileInput); err != nil {
		return "", err
	}

	mu.Lock()
	defer mu.Unlock()

	s, err := requireUnlocked()
	if err != nil {
		return "", err
	}
	mode, err := normalizeProfileMode(profileInput.ExternalMode)
	if err != nil {
		return "", err
	}
	profile, err := s.AddProfile(vault.Profile{
		Name:            profileInput.Name,
		TunnelConfig:    profileInput.TunnelConfig,
		DashboardURL:    profileInput.DashboardURL,
		AllowExternal:   mode != external.ModeOff,
		ExternalMode:    mode,
		ExternalOrigins: append([]string(nil), profileInput.ExternalOrigins...),
	})
	if err != nil {
		return "", err
	}
	return marshal(profileSummary(s, profile))
}

// UpdateProfileJSON updates a profile. An empty TunnelConfig keeps the stored
// config, and saved credentials are preserved.
func UpdateProfileJSON(input string) (string, error) {
	var profileInput ProfileInput
	if err := json.Unmarshal([]byte(input), &profileInput); err != nil {
		return "", err
	}
	if strings.TrimSpace(profileInput.ID) == "" {
		return "", vault.ErrProfileNotFound
	}

	mu.Lock()
	defer mu.Unlock()

	s, err := requireUnlocked()
	if err != nil {
		return "", err
	}
	profile, ok := s.Profile(profileInput.ID)
	if !ok {
		return "", vault.ErrProfileNotFound
	}
	if strings.TrimSpace(profileInput.Name) != "" {
		profile.Name = profileInput.Name
	}
	if strings.TrimSpace(profileInput.DashboardURL) != "" {
		profile.DashboardURL = profileInput.DashboardURL
	}
	if strings.TrimSpace(profileInput.TunnelConfig) != "" {
		profile.TunnelConfig = profileInput.TunnelConfig
	}
	mode, err := normalizeProfileMode(profileInput.ExternalMode)
	if err != nil {
		return "", err
	}
	profile.AllowExternal = mode != external.ModeOff
	profile.ExternalMode = mode
	profile.ExternalOrigins = append([]string(nil), profileInput.ExternalOrigins...)
	if err := s.UpdateProfile(profile); err != nil {
		return "", err
	}
	return marshal(profileSummary(s, profile))
}

// DeleteProfile removes a profile and its credentials.
func DeleteProfile(id string) error {
	mu.Lock()
	defer mu.Unlock()

	s, err := requireUnlocked()
	if err != nil {
		return err
	}
	return s.DeleteProfile(id)
}

// SetActiveProfile marks one profile as active.
func SetActiveProfile(id string) error {
	mu.Lock()
	defer mu.Unlock()

	s, err := requireUnlocked()
	if err != nil {
		return err
	}
	return s.SetActiveProfile(id)
}

// SettingsJSON combines the shared LAN policy with the Android settings.
func SettingsJSON() (string, error) {
	mu.Lock()
	defer mu.Unlock()

	s, err := requireUnlocked()
	if err != nil {
		return "", err
	}
	security := s.SecuritySettings()
	android := s.AndroidSettings()
	return marshal(Settings{
		ForceLANOnly:             security.ForceLANOnly,
		LockOnBackground:         android.LockOnBackground,
		AutoConnect:              android.AutoConnect,
		OpenPublicLinksInBrowser: android.OpenPublicLinksInBrowser,
	})
}

// SetSettingsJSON updates ForceLANOnly while preserving the desktop idle
// settings, then stores the Android preferences.
func SetSettingsJSON(input string) error {
	var settings Settings
	if err := json.Unmarshal([]byte(input), &settings); err != nil {
		return err
	}

	mu.Lock()
	defer mu.Unlock()

	s, err := requireUnlocked()
	if err != nil {
		return err
	}
	security := s.SecuritySettings()
	security.ForceLANOnly = settings.ForceLANOnly
	if err := s.SetSecuritySettings(security); err != nil {
		return err
	}
	return s.SetAndroidSettings(vault.AndroidSettings{
		LockOnBackground:         settings.LockOnBackground,
		AutoConnect:              settings.AutoConnect,
		OpenPublicLinksInBrowser: settings.OpenPublicLinksInBrowser,
	})
}

// ExportVault returns the encrypted portable vault bytes.
func ExportVault(password string) ([]byte, error) {
	mu.Lock()
	defer mu.Unlock()

	s, err := requireUnlocked()
	if err != nil {
		return nil, err
	}
	return s.ExportBytes(password)
}

// ImportVault merges encrypted portable vault bytes into the open vault.
func ImportVault(data []byte, password string) error {
	mu.Lock()
	defer mu.Unlock()

	s, err := requireUnlocked()
	if err != nil {
		return err
	}
	return s.ImportBytes(data, password)
}

// NavigationKind classifies a top-level link for the WebView.
func NavigationKind(raw string) string {
	return nav.Classify(raw).String()
}

func requireUnlocked() (*vault.Store, error) {
	if store == nil {
		return nil, errors.New("no vault is open")
	}
	if !store.Unlocked() {
		return nil, vault.ErrLocked
	}
	return store, nil
}

func normalizeProfileMode(raw string) (string, error) {
	mode := strings.ToLower(strings.TrimSpace(raw))
	switch mode {
	case "", external.ModeOff:
		return external.ModeOff, nil
	case external.ModeAll:
		return external.ModeAll, nil
	case external.ModeOrigins:
		return external.ModeOrigins, nil
	default:
		return "", fmt.Errorf("unsupported external mode %q", raw)
	}
}

func profileSummary(s *vault.Store, profile vault.Profile) ProfileSummary {
	active, _ := s.ActiveProfile()
	return ProfileSummary{
		ID:           profile.ID,
		Name:         profile.Name,
		DashboardURL: profile.DashboardURL,
		ExternalMode: profile.EffectiveExternalMode(),
		Active:       profile.ID == active.ID,
	}
}

func marshal(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}
