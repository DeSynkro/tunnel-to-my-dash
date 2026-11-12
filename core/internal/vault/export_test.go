package vault

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func exportVault(t *testing.T, password string) (string, *Store, Profile, Profile) {
	t.Helper()

	src, _ := newKeyFileVault(t)
	home, err := src.AddProfile(newProfile(t, "Home"))
	if err != nil {
		t.Fatal(err)
	}
	office, err := src.AddProfile(newProfile(t, "Office"))
	if err != nil {
		t.Fatal(err)
	}
	if err := src.SetActiveProfile(office.ID); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "backup.ttmd")
	if err := src.Export(path, password); err != nil {
		t.Fatal(err)
	}
	return path, src, home, office
}

func TestExportImport(t *testing.T) {
	path, _, _, office := exportVault(t, "backup password")

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("export permissions = %#o, want 0600", got)
		}
	}

	data, err := ReadExport(path, "backup password")
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Profiles) != 2 {
		t.Fatalf("exported profiles = %d, want 2", len(data.Profiles))
	}
	if data.ActiveProfile != office.ID {
		t.Fatalf("exported active profile = %q, want %q", data.ActiveProfile, office.ID)
	}

	if _, err := ReadExport(path, "wrong"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong export password error = %v", err)
	}

	dst, _ := newKeyFileVault(t)
	if err := dst.Import(path, "backup password"); err != nil {
		t.Fatal(err)
	}
	got := dst.Profiles()
	if len(got) != 2 || got[0].Name != "Home" || got[1].Name != "Office" {
		t.Fatalf("imported profiles = %+v", got)
	}
	active, ok := dst.ActiveProfile()
	if !ok || active.ID != office.ID {
		t.Fatalf("imported active profile = %+v, ok = %v", active, ok)
	}
}

func TestImportWrongPasswordLeavesVaultAlone(t *testing.T) {
	path, _, _, _ := exportVault(t, "backup password")

	dst, _ := newKeyFileVault(t)
	if err := dst.Import(path, "wrong"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("error = %v, want ErrWrongPassword", err)
	}
	if got := dst.Profiles(); len(got) != 0 {
		t.Fatalf("profiles after failed import = %+v", got)
	}
}

func TestImportDuplicateID(t *testing.T) {
	src, _ := newKeyFileVault(t)
	profile := newProfile(t, "Home")
	profile.ID = "fixed-id"
	if _, err := src.AddProfile(profile); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "backup.ttmd")
	if err := src.Export(path, "backup password"); err != nil {
		t.Fatal(err)
	}

	dst, _ := newKeyFileVault(t)
	existing := newProfile(t, "Existing")
	existing.ID = "fixed-id"
	if _, err := dst.AddProfile(existing); err != nil {
		t.Fatal(err)
	}

	if err := dst.Import(path, "backup password"); !errors.Is(err, ErrProfileExists) {
		t.Fatalf("error = %v, want ErrProfileExists", err)
	}
	if got := dst.Profiles(); len(got) != 1 || got[0].Name != "Existing" {
		t.Fatalf("profiles after duplicate import = %+v", got)
	}
}

func TestExportLocked(t *testing.T) {
	src, _ := newKeyFileVault(t)
	src.Lock()

	if err := src.Export(filepath.Join(t.TempDir(), "backup.ttmd"), "password"); !errors.Is(err, ErrLocked) {
		t.Fatalf("error = %v, want ErrLocked", err)
	}
}

func TestExportDoesNotStorePlaintext(t *testing.T) {
	src, _ := newKeyFileVault(t)
	profile := newProfile(t, "Home")
	profile.TunnelConfig += "\n# LEAKME\n"
	if _, err := src.AddProfile(profile); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "backup.ttmd")
	if err := src.Export(path, "backup password"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "LEAKME") {
		t.Fatal("export file contains plaintext tunnel text")
	}
}

func TestExportPathCollision(t *testing.T) {
	src, _ := newKeyFileVault(t)

	if err := src.Export(src.path, "password"); err == nil {
		t.Fatal("export over the vault path was allowed")
	}
	if err := src.Export(src.keyPath, "password"); err == nil {
		t.Fatal("export over the key path was allowed")
	}
}
