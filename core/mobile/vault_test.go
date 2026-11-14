package mobile

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/vault"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

func resetBridge(t *testing.T) {
	t.Helper()
	_ = Stop()
	mu.Lock()
	store = nil
	active = nil
	mu.Unlock()
	t.Cleanup(func() {
		_ = Stop()
		mu.Lock()
		store = nil
		active = nil
		mu.Unlock()
	})
}

func validTunnelConfig(t *testing.T) string {
	t.Helper()
	private, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	peer, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	psk, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf(`[Interface]
PrivateKey = %s
Address = 10.66.0.2/24
MTU = 1420

[Peer]
PublicKey = %s
PresharedKey = %s
Endpoint = 203.0.113.10:51820
AllowedIPs = 0.0.0.0/0
`, private, peer.PublicKey(), psk)
}

func addTestProfile(t *testing.T, name, externalMode string) ProfileSummary {
	t.Helper()
	input, err := json.Marshal(ProfileInput{
		Name:         name,
		TunnelConfig: validTunnelConfig(t),
		DashboardURL: "http://192.168.1.10:3000",
		ExternalMode: externalMode,
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := AddProfileJSON(string(input))
	if err != nil {
		t.Fatal(err)
	}
	var summary ProfileSummary
	if err := json.Unmarshal([]byte(raw), &summary); err != nil {
		t.Fatal(err)
	}
	return summary
}

func decodeStatus(t *testing.T) VaultStatus {
	t.Helper()
	raw, err := VaultStatusJSON()
	if err != nil {
		t.Fatal(err)
	}
	var status VaultStatus
	if err := json.Unmarshal([]byte(raw), &status); err != nil {
		t.Fatal(err)
	}
	return status
}

func decodeProfiles(t *testing.T) []ProfileSummary {
	t.Helper()
	raw, err := ProfilesJSON()
	if err != nil {
		t.Fatal(err)
	}
	var profiles []ProfileSummary
	if err := json.Unmarshal([]byte(raw), &profiles); err != nil {
		t.Fatal(err)
	}
	return profiles
}

func decodeSettings(t *testing.T) Settings {
	t.Helper()
	raw, err := SettingsJSON()
	if err != nil {
		t.Fatal(err)
	}
	var settings Settings
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		t.Fatal(err)
	}
	return settings
}

func TestVaultKeyfileLifecycle(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")

	if VaultExists(path) {
		t.Fatal("VaultExists reported a missing vault")
	}
	if err := CreateVault(path, ""); err != nil {
		t.Fatal(err)
	}
	if !VaultExists(path) {
		t.Fatal("VaultExists did not see the new vault")
	}

	status := decodeStatus(t)
	if !status.HasVault || status.Locked || status.PasswordProtected {
		t.Fatalf("keyfile status = %+v", status)
	}

	settings := decodeSettings(t)
	if !settings.LockOnBackground {
		t.Fatalf("default settings = %+v, want LockOnBackground", settings)
	}

	home := addTestProfile(t, "Home", "off")
	office := addTestProfile(t, "Office", "all")
	if home.ID == "" || office.ID == "" || home.ID == office.ID {
		t.Fatalf("profile IDs = %q, %q", home.ID, office.ID)
	}
	profiles := decodeProfiles(t)
	if len(profiles) != 2 || !profiles[0].Active || profiles[1].Active {
		t.Fatalf("profiles = %+v", profiles)
	}

	raw, err := ProfileJSON(home.ID)
	if err != nil {
		t.Fatal(err)
	}
	var detail ProfileDetail
	if err := json.Unmarshal([]byte(raw), &detail); err != nil {
		t.Fatal(err)
	}
	if !detail.HasTunnelConfig || detail.Name != "Home" {
		t.Fatalf("profile detail = %+v", detail)
	}

	update, err := json.Marshal(ProfileInput{
		ID:           home.ID,
		Name:         "Home updated",
		DashboardURL: "http://192.168.1.10:3000",
		ExternalMode: "all",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateProfileJSON(string(update)); err != nil {
		t.Fatal(err)
	}
	if err := SetActiveProfile(office.ID); err != nil {
		t.Fatal(err)
	}
	profiles = decodeProfiles(t)
	if !profiles[1].Active || profiles[1].Name != "Office" {
		t.Fatalf("active profile = %+v", profiles)
	}

	if err := DeleteProfile(office.ID); err != nil {
		t.Fatal(err)
	}
	if got := decodeProfiles(t); len(got) != 1 || got[0].Name != "Home updated" {
		t.Fatalf("profiles after delete = %+v", got)
	}
}

func TestVaultPasswordLifecycle(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, "correct horse"); err != nil {
		t.Fatal(err)
	}
	LockVault()

	status := decodeStatus(t)
	if !status.Locked || !status.PasswordProtected {
		t.Fatalf("password status = %+v", status)
	}
	if _, err := ProfilesJSON(); err == nil {
		t.Fatal("ProfilesJSON succeeded while locked")
	}
	if err := UnlockVault("wrong"); err == nil {
		t.Fatal("UnlockVault accepted a wrong password")
	}
	if err := UnlockVault("correct horse"); err != nil {
		t.Fatal(err)
	}
	if status := decodeStatus(t); status.Locked {
		t.Fatalf("status after unlock = %+v", status)
	}

	LockVault()
	if status := decodeStatus(t); !status.Locked {
		t.Fatalf("status after lock = %+v", status)
	}
}

func TestProfileUpdatePreservesCredentials(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, ""); err != nil {
		t.Fatal(err)
	}
	home := addTestProfile(t, "Home", "off")
	mu.Lock()
	stored, ok := store.Profile(home.ID)
	mu.Unlock()
	if !ok {
		t.Fatal("profile missing after add")
	}
	homeConfig := stored.TunnelConfig

	mu.Lock()
	_, err := store.AddCredential(home.ID, vault.Credential{
		ID:       "credential1",
		Name:     "Login",
		Password: "secret",
	})
	mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

	input, err := json.Marshal(ProfileInput{
		ID:           home.ID,
		Name:         "Home renamed",
		DashboardURL: "http://192.168.1.10:3000",
		ExternalMode: "all",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateProfileJSON(string(input)); err != nil {
		t.Fatal(err)
	}

	mu.Lock()
	updated, ok := store.Profile(home.ID)
	mu.Unlock()
	if !ok {
		t.Fatal("profile missing after update")
	}
	if len(updated.Credentials) != 1 || updated.Credentials[0].ID != "credential1" {
		t.Fatalf("credentials after update = %+v", updated.Credentials)
	}
	if updated.TunnelConfig != homeConfig {
		t.Fatalf("tunnel config after update changed")
	}
}

func TestExportImportBridge(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, ""); err != nil {
		t.Fatal(err)
	}
	addTestProfile(t, "Home", "off")

	data, err := ExportVault("backup password")
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 {
		t.Fatal("ExportVault returned no data")
	}
	if err := ImportVault(data, "wrong"); err == nil {
		t.Fatal("ImportVault accepted a wrong password")
	}

	dest := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(dest, ""); err != nil {
		t.Fatal(err)
	}
	if err := ImportVault(data, "backup password"); err != nil {
		t.Fatal(err)
	}
	if got := decodeProfiles(t); len(got) != 1 || got[0].Name != "Home" {
		t.Fatalf("imported profiles = %+v", got)
	}
}

func TestNavigationKindBridge(t *testing.T) {
	resetBridge(t)
	tests := []struct {
		url  string
		want string
	}{
		{url: "https://example.com/", want: "public"},
		{url: "http://192.168.1.10:3000/", want: "private"},
		{url: "javascript:alert(1)", want: "blocked"},
	}
	for _, tt := range tests {
		if got := NavigationKind(tt.url); got != tt.want {
			t.Fatalf("NavigationKind(%q) = %q, want %q", tt.url, got, tt.want)
		}
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, ""); err != nil {
		t.Fatal(err)
	}

	mu.Lock()
	err := store.SetSecuritySettings(vault.SecuritySettings{
		LockAfterIdle: true,
		IdleMinutes:   30,
	})
	mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

	input, err := json.Marshal(Settings{
		ForceLANOnly:             true,
		LockOnBackground:         false,
		AutoConnect:              true,
		OpenPublicLinksInBrowser: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := SetSettingsJSON(string(input)); err != nil {
		t.Fatal(err)
	}
	settings := decodeSettings(t)
	if !settings.ForceLANOnly || settings.LockOnBackground ||
		!settings.AutoConnect || !settings.OpenPublicLinksInBrowser {
		t.Fatalf("settings = %+v", settings)
	}

	mu.Lock()
	security := store.SecuritySettings()
	mu.Unlock()
	if !security.LockAfterIdle || security.IdleMinutes != 30 {
		t.Fatalf("desktop settings changed: %+v", security)
	}
}

func TestLockedProfileError(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, "password"); err != nil {
		t.Fatal(err)
	}
	LockVault()
	_, err := ProfilesJSON()
	if !errors.Is(err, vault.ErrLocked) {
		t.Fatalf("ProfilesJSON error = %v, want ErrLocked", err)
	}
}

func TestVerifyPasswordBridge(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, "correct horse"); err != nil {
		t.Fatal(err)
	}

	if err := VerifyVaultPassword("correct horse"); err != nil {
		t.Fatalf("correct password error = %v", err)
	}
	if err := VerifyVaultPassword("wrong"); !errors.Is(err, vault.ErrWrongPassword) {
		t.Fatalf("wrong password error = %v, want ErrWrongPassword", err)
	}
}

func TestOpenVaultIsIdempotent(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, "secret"); err != nil {
		t.Fatal(err)
	}
	addTestProfile(t, "Home", "off")

	if err := OpenVault(path); err != nil {
		t.Fatal(err)
	}
	if status := decodeStatus(t); status.Locked {
		t.Fatalf("reopening the same vault locked it: %+v", status)
	}
	if profiles := decodeProfiles(t); len(profiles) != 1 {
		t.Fatalf("profiles after idempotent reopen = %+v", profiles)
	}
}

func TestProfileOriginsPreserved(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, ""); err != nil {
		t.Fatal(err)
	}

	input, err := json.Marshal(ProfileInput{
		Name:            "Home",
		TunnelConfig:    validTunnelConfig(t),
		DashboardURL:    "http://192.168.1.10:3000",
		ExternalMode:    "origins",
		ExternalOrigins: []string{"https://example.com"},
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := AddProfileJSON(string(input))
	if err != nil {
		t.Fatal(err)
	}
	var summary ProfileSummary
	if err := json.Unmarshal([]byte(raw), &summary); err != nil {
		t.Fatal(err)
	}

	detailRaw, err := ProfileJSON(summary.ID)
	if err != nil {
		t.Fatal(err)
	}
	var detail ProfileDetail
	if err := json.Unmarshal([]byte(detailRaw), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.ExternalMode != "origins" || len(detail.ExternalOrigins) != 1 {
		t.Fatalf("detail = %+v", detail)
	}

	update, err := json.Marshal(ProfileInput{
		ID:              summary.ID,
		Name:            "Home renamed",
		DashboardURL:    "http://192.168.1.10:3000",
		ExternalMode:    "origins",
		ExternalOrigins: []string{"https://example.com"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateProfileJSON(string(update)); err != nil {
		t.Fatal(err)
	}
	detailRaw, err = ProfileJSON(summary.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(detailRaw), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.Name != "Home renamed" || detail.ExternalMode != "origins" ||
		len(detail.ExternalOrigins) != 1 || detail.ExternalOrigins[0] != "https://example.com" {
		t.Fatalf("detail after update = %+v", detail)
	}

	offUpdate, err := json.Marshal(ProfileInput{
		ID:           summary.ID,
		Name:         "Home renamed",
		DashboardURL: "http://192.168.1.10:3000",
		ExternalMode: "off",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateProfileJSON(string(offUpdate)); err != nil {
		t.Fatal(err)
	}
	detailRaw, err = ProfileJSON(summary.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(detailRaw), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.ExternalMode != "off" || len(detail.ExternalOrigins) != 1 {
		t.Fatalf("origins after turning external off = %+v", detail)
	}

	onUpdate, err := json.Marshal(ProfileInput{
		ID:           summary.ID,
		Name:         "Home renamed",
		DashboardURL: "http://192.168.1.10:3000",
		ExternalMode: "origins",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateProfileJSON(string(onUpdate)); err != nil {
		t.Fatal(err)
	}
	detailRaw, err = ProfileJSON(summary.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(detailRaw), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.ExternalMode != "origins" || len(detail.ExternalOrigins) != 1 ||
		detail.ExternalOrigins[0] != "https://example.com" {
		t.Fatalf("origins after turning external back on = %+v", detail)
	}
}

func TestLockVaultLeavesKeyfileOpen(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, ""); err != nil {
		t.Fatal(err)
	}

	LockVault()

	if status := decodeStatus(t); status.Locked {
		t.Fatalf("keyfile vault locked: %+v", status)
	}
	if _, err := ProfilesJSON(); err != nil {
		t.Fatalf("ProfilesJSON after LockVault = %v", err)
	}
}
