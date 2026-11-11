package vault

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func newPasswordVault(t *testing.T, password string) (*Store, string) {
	t.Helper()

	path := filepath.Join(t.TempDir(), "vault.json")
	s, err := Create(path, password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddProfile(newProfile(t, "Home")); err != nil {
		t.Fatal(err)
	}
	return s, path
}

func TestChangePassword(t *testing.T) {
	s, path := newPasswordVault(t, "old password")

	if err := s.ChangePassword("wrong", "new password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong old password error = %v", err)
	}
	if err := s.ChangePassword("old password", "new password"); err != nil {
		t.Fatal(err)
	}

	s.Lock()
	opened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := opened.Unlock("old password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("old password error = %v", err)
	}
	if err := opened.Unlock("new password"); err != nil {
		t.Fatal(err)
	}
	if got := opened.Profiles(); len(got) != 1 || got[0].Name != "Home" {
		t.Fatalf("profiles = %+v", got)
	}
}

func TestConvertPasswordToKeyFile(t *testing.T) {
	s, path := newPasswordVault(t, "old password")

	if err := s.ChangePassword("old password", ""); err != nil {
		t.Fatal(err)
	}
	if s.PasswordProtected() {
		t.Fatal("vault is still password protected")
	}

	info, err := os.Stat(s.keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("key permissions = %#o, want 0600", got)
	}

	var meta metadata
	if err := readJSON(path, &meta); err != nil {
		t.Fatal(err)
	}
	if meta.Mode != modeKeyFile || meta.KDF != nil {
		t.Fatalf("metadata mode = %q, kdf = %+v", meta.Mode, meta.KDF)
	}

	s.Lock()
	opened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if !opened.Unlocked() {
		t.Fatal("keyfile vault did not open unlocked")
	}
	if got := opened.Profiles(); len(got) != 1 || got[0].Name != "Home" {
		t.Fatalf("profiles = %+v", got)
	}
}

func TestConvertKeyFileToPassword(t *testing.T) {
	s, path := newKeyFileVault(t)
	if _, err := s.AddProfile(newProfile(t, "Home")); err != nil {
		t.Fatal(err)
	}

	if err := s.ChangePassword("", "new password"); err != nil {
		t.Fatal(err)
	}
	if !s.PasswordProtected() {
		t.Fatal("vault is not password protected")
	}
	if _, err := os.Stat(s.keyPath); !os.IsNotExist(err) {
		t.Fatalf("key file still exists: %v", err)
	}

	s.Lock()
	opened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Unlocked() {
		t.Fatal("password vault opened unlocked")
	}
	if err := opened.Unlock("new password"); err != nil {
		t.Fatal(err)
	}
	if got := opened.Profiles(); len(got) != 1 || got[0].Name != "Home" {
		t.Fatalf("profiles = %+v", got)
	}
}

func TestChangePasswordWhileLocked(t *testing.T) {
	s, _ := newPasswordVault(t, "old password")
	s.Lock()

	if err := s.ChangePassword("old password", "new password"); !errors.Is(err, ErrLocked) {
		t.Fatalf("error = %v, want ErrLocked", err)
	}
}
