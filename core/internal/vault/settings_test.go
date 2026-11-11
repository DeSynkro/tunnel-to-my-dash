package vault

import (
	"errors"
	"testing"
)

func TestSecuritySettingsDefaults(t *testing.T) {
	s, _ := newKeyFileVault(t)

	got := s.SecuritySettings()
	if got.ForceLANOnly || got.LockAfterIdle || got.IdleMinutes != DefaultIdleMinutes {
		t.Fatalf("defaults = %+v", got)
	}
}

func TestSecuritySettingsRoundTrip(t *testing.T) {
	s, path := newKeyFileVault(t)

	want := SecuritySettings{
		ForceLANOnly:  true,
		LockAfterIdle: true,
		IdleMinutes:   30,
	}
	if err := s.SetSecuritySettings(want); err != nil {
		t.Fatal(err)
	}

	s.Lock()
	opened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := opened.SecuritySettings(); got != want {
		t.Fatalf("settings = %+v, want %+v", got, want)
	}
}

func TestSecuritySettingsRejectBadIdleMinutes(t *testing.T) {
	s, _ := newKeyFileVault(t)

	err := s.SetSecuritySettings(SecuritySettings{
		LockAfterIdle: true,
		IdleMinutes:   7,
	})
	if !errors.Is(err, ErrInvalidSettings) {
		t.Fatalf("error = %v, want ErrInvalidSettings", err)
	}
}
