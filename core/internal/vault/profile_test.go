package vault

import (
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

func validTunnel(t *testing.T) string {
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

func newProfile(t *testing.T, name string) Profile {
	t.Helper()
	return Profile{
		Name:         name,
		TunnelConfig: validTunnel(t),
		DashboardURL: "http://192.168.1.10:8080",
	}
}

func newKeyFileVault(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "vault.json")
	s, err := Create(path, "")
	if err != nil {
		t.Fatal(err)
	}
	return s, path
}

func TestProfileCRUD(t *testing.T) {
	s, _ := newKeyFileVault(t)

	home, err := s.AddProfile(newProfile(t, "Home"))
	if err != nil {
		t.Fatal(err)
	}
	if len(home.ID) != 16 {
		t.Fatalf("profile ID = %q, want 16 hex characters", home.ID)
	}
	if home.Name != "Home" {
		t.Fatalf("name = %q", home.Name)
	}

	active, ok := s.ActiveProfile()
	if !ok || active.ID != home.ID {
		t.Fatalf("active profile = %+v, ok = %v", active, ok)
	}

	office, err := s.AddProfile(newProfile(t, "Office"))
	if err != nil {
		t.Fatal(err)
	}
	if office.ID == home.ID {
		t.Fatal("profile IDs are not unique")
	}
	active, _ = s.ActiveProfile()
	if active.ID != home.ID {
		t.Fatalf("active profile changed to %q", active.ID)
	}

	if err := s.SetActiveProfile(office.ID); err != nil {
		t.Fatal(err)
	}
	active, _ = s.ActiveProfile()
	if active.ID != office.ID {
		t.Fatalf("active profile = %q, want %q", active.ID, office.ID)
	}

	updated := home
	updated.Name = "Home 2"
	if err := s.UpdateProfile(updated); err != nil {
		t.Fatal(err)
	}
	if got := s.Profiles()[0].Name; got != "Home 2" {
		t.Fatalf("updated name = %q", got)
	}
	if got, ok := s.Profile(home.ID); !ok || got.Name != "Home 2" {
		t.Fatalf("profile lookup = %+v, ok = %v", got, ok)
	}
	if _, ok := s.Profile("missing"); ok {
		t.Fatal("found a missing profile")
	}

	if err := s.DeleteProfile(office.ID); err != nil {
		t.Fatal(err)
	}
	active, ok = s.ActiveProfile()
	if !ok || active.ID != home.ID {
		t.Fatalf("active profile after delete = %+v, ok = %v", active, ok)
	}

	if err := s.DeleteProfile(home.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.ActiveProfile(); ok {
		t.Fatal("active profile still exists after deleting the last one")
	}
	if got := s.Profiles(); len(got) != 0 {
		t.Fatalf("profiles = %+v", got)
	}
}

func TestProfileValidation(t *testing.T) {
	s, _ := newKeyFileVault(t)

	cases := []struct {
		name   string
		mutate func(Profile) Profile
	}{
		{"empty name", func(p Profile) Profile { p.Name = " "; return p }},
		{"bad tunnel", func(p Profile) Profile { p.TunnelConfig = "nope"; return p }},
		{"public dashboard", func(p Profile) Profile { p.DashboardURL = "http://8.8.8.8:8080"; return p }},
		{"hostname dashboard", func(p Profile) Profile { p.DashboardURL = "http://dashboard.local:8080"; return p }},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			_, err := s.AddProfile(tt.mutate(newProfile(t, "Home")))
			if !errors.Is(err, ErrInvalidProfile) {
				t.Fatalf("error = %v, want ErrInvalidProfile", err)
			}
		})
	}
}

func TestDuplicateProfileID(t *testing.T) {
	s, _ := newKeyFileVault(t)

	first := newProfile(t, "Home")
	first.ID = "fixed-id"
	if _, err := s.AddProfile(first); err != nil {
		t.Fatal(err)
	}

	second := newProfile(t, "Office")
	second.ID = "fixed-id"
	if _, err := s.AddProfile(second); !errors.Is(err, ErrProfileExists) {
		t.Fatalf("error = %v, want ErrProfileExists", err)
	}
}

func TestMissingProfiles(t *testing.T) {
	s, _ := newKeyFileVault(t)

	if err := s.SetActiveProfile("missing"); !errors.Is(err, ErrProfileNotFound) {
		t.Fatalf("set active error = %v", err)
	}
	if err := s.UpdateProfile(Profile{ID: "missing"}); !errors.Is(err, ErrProfileNotFound) {
		t.Fatalf("update error = %v", err)
	}
	if err := s.DeleteProfile("missing"); !errors.Is(err, ErrProfileNotFound) {
		t.Fatalf("delete error = %v", err)
	}
}

func TestLockedStoreProfileMethods(t *testing.T) {
	s, _ := newKeyFileVault(t)
	if _, err := s.AddProfile(newProfile(t, "Home")); err != nil {
		t.Fatal(err)
	}
	s.Lock()

	if got := s.Profiles(); got != nil {
		t.Fatalf("profiles while locked = %+v", got)
	}
	if _, ok := s.ActiveProfile(); ok {
		t.Fatal("active profile while locked")
	}
	if _, err := s.AddProfile(newProfile(t, "Office")); !errors.Is(err, ErrLocked) {
		t.Fatalf("add error = %v", err)
	}
	if err := s.UpdateProfile(Profile{ID: "x"}); !errors.Is(err, ErrLocked) {
		t.Fatalf("update error = %v", err)
	}
	if err := s.DeleteProfile("x"); !errors.Is(err, ErrLocked) {
		t.Fatalf("delete error = %v", err)
	}
	if err := s.SetActiveProfile("x"); !errors.Is(err, ErrLocked) {
		t.Fatalf("set active error = %v", err)
	}
}

func TestProfilePersistence(t *testing.T) {
	s, path := newKeyFileVault(t)

	home, err := s.AddProfile(newProfile(t, "Home"))
	if err != nil {
		t.Fatal(err)
	}
	s.Lock()

	opened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	profiles := opened.Profiles()
	if len(profiles) != 1 || profiles[0].ID != home.ID || profiles[0].Name != "Home" {
		t.Fatalf("profiles = %+v", profiles)
	}
	active, ok := opened.ActiveProfile()
	if !ok || active.ID != home.ID {
		t.Fatalf("active profile = %+v, ok = %v", active, ok)
	}
}

func TestProfileNameTrimmed(t *testing.T) {
	s, _ := newKeyFileVault(t)

	profile, err := s.AddProfile(newProfile(t, "  Home  "))
	if err != nil {
		t.Fatal(err)
	}
	if profile.Name != "Home" {
		t.Fatalf("name = %q, want Home", profile.Name)
	}
}

func TestProfilesAreCopies(t *testing.T) {
	s, _ := newKeyFileVault(t)

	profile := newProfile(t, "Home")
	profile.ExternalOrigins = []string{"https://fonts.example"}
	if _, err := s.AddProfile(profile); err != nil {
		t.Fatal(err)
	}

	got := s.Profiles()
	got[0].Name = "Changed"
	got[0].ExternalOrigins[0] = "https://changed.example"

	again := s.Profiles()
	if again[0].Name != "Home" {
		t.Fatalf("stored name = %q", again[0].Name)
	}
	if again[0].ExternalOrigins[0] != "https://fonts.example" {
		t.Fatalf("stored origin = %q", again[0].ExternalOrigins[0])
	}
}

func TestProfileRejectsInvalidExternalOrigin(t *testing.T) {
	s, _ := newKeyFileVault(t)

	profile := newProfile(t, "Home")
	profile.AllowExternal = true
	profile.ExternalOrigins = []string{"https://fonts.example/path"}
	if _, err := s.AddProfile(profile); !errors.Is(err, ErrInvalidProfile) {
		t.Fatalf("AddProfile error = %v, want ErrInvalidProfile", err)
	}
}

func TestEffectiveExternalMode(t *testing.T) {
	tests := []struct {
		name string
		p    Profile
		want string
	}{
		{"legacy off", Profile{}, "off"},
		{"legacy on", Profile{AllowExternal: true}, "origins"},
		{"explicit all", Profile{ExternalMode: "all"}, "all"},
		{"explicit wins over legacy", Profile{AllowExternal: true, ExternalMode: "off"}, "off"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.p.EffectiveExternalMode(); got != tt.want {
				t.Fatalf("mode = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestProfileRejectsInvalidExternalMode(t *testing.T) {
	s, _ := newKeyFileVault(t)

	profile := newProfile(t, "Home")
	profile.ExternalMode = "sometimes"
	if _, err := s.AddProfile(profile); !errors.Is(err, ErrInvalidProfile) {
		t.Fatalf("AddProfile error = %v, want ErrInvalidProfile", err)
	}
}
