package mobile

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/external"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/vault"
)

func TestConnectionOptions(t *testing.T) {
	profile := vault.Profile{
		ID:              "profile1",
		Name:            "Home",
		ExternalMode:    external.ModeAll,
		AllowExternal:   true,
		ExternalOrigins: []string{"https://example.com"},
	}

	opts, err := connectionOptions(profile, vault.SecuritySettings{})
	if err != nil {
		t.Fatal(err)
	}
	if opts.ExternalMode != external.ModeAll || !opts.AllowExternal {
		t.Fatalf("all options = %+v", opts)
	}
	if len(opts.ExternalOrigins) != 1 || opts.ExternalOrigins[0] != "https://example.com" {
		t.Fatalf("external origins = %+v", opts.ExternalOrigins)
	}

	opts, err = connectionOptions(profile, vault.SecuritySettings{ForceLANOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if opts.ExternalMode != external.ModeOff || opts.AllowExternal {
		t.Fatalf("force LAN options = %+v", opts)
	}

	profile.ExternalMode = external.ModeOrigins
	opts, err = connectionOptions(profile, vault.SecuritySettings{})
	if err != nil {
		t.Fatal(err)
	}
	if opts.ExternalMode != external.ModeOrigins || !opts.AllowExternal {
		t.Fatalf("origins options = %+v", opts)
	}
}

func TestStartProfileRequiresUnlockedVault(t *testing.T) {
	resetBridge(t)

	if _, err := StartProfile("anything"); err == nil {
		t.Fatal("StartProfile succeeded without a vault")
	}

	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, "password"); err != nil {
		t.Fatal(err)
	}
	LockVault()
	if _, err := StartProfile("anything"); !errors.Is(err, vault.ErrLocked) {
		t.Fatalf("locked StartProfile error = %v, want ErrLocked", err)
	}
}

func TestStartProfileMissingProfile(t *testing.T) {
	resetBridge(t)
	path := filepath.Join(t.TempDir(), "vault")
	if err := CreateVault(path, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := StartProfile("missing"); !errors.Is(err, vault.ErrProfileNotFound) {
		t.Fatalf("missing profile error = %v, want ErrProfileNotFound", err)
	}
}
