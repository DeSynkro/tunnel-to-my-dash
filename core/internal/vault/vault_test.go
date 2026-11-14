package vault

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func testData() Data {
	return Data{
		Version:       formatVersion,
		ActiveProfile: "home",
		Profiles: []Profile{{
			ID:           "home",
			Name:         "Home",
			TunnelConfig: "PrivateKey = test-only",
			DashboardURL: "http://192.168.1.10:8080",
		}},
	}
}

func createLocked(t *testing.T, password string) (*Store, string) {
	t.Helper()

	path := filepath.Join(t.TempDir(), "vault.json")
	s, err := Create(path, password)
	if err != nil {
		t.Fatal(err)
	}
	s.data = testData()
	if err := s.save(); err != nil {
		t.Fatal(err)
	}
	s.Lock()
	return s, path
}

func TestPasswordVaultRoundTrip(t *testing.T) {
	_, path := createLocked(t, "correct horse battery staple")

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("vault permissions = %#o, want 0600", got)
		}
	}

	opened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Unlocked() {
		t.Fatal("password vault should open locked")
	}

	if err := opened.Unlock("wrong"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong password error = %v", err)
	}
	if err := opened.Unlock("correct horse battery staple"); err != nil {
		t.Fatal(err)
	}
	if !opened.Unlocked() {
		t.Fatal("vault did not unlock")
	}
	if len(opened.data.Profiles) != 1 || opened.data.Profiles[0].ID != "home" {
		t.Fatalf("profiles = %+v", opened.data.Profiles)
	}
}

func TestTamperedCiphertext(t *testing.T) {
	_, path := createLocked(t, "correct horse battery staple")

	var meta metadata
	if err := readJSON(path, &meta); err != nil {
		t.Fatal(err)
	}
	ciphertext, err := unb64(meta.Ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[0] ^= 0xff
	meta.Ciphertext = b64(ciphertext)
	if err := writeJSONAtomic(path, meta, 0o600); err != nil {
		t.Fatal(err)
	}

	opened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := opened.Unlock("correct horse battery staple"); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("error = %v, want ErrCorrupt", err)
	}
}

func TestKeyFileVault(t *testing.T) {
	path := filepath.Join(t.TempDir(), "vault.json")
	s, err := Create(path, "")
	if err != nil {
		t.Fatal(err)
	}
	if s.meta.Mode != modeKeyFile {
		t.Fatalf("mode = %q, want %q", s.meta.Mode, modeKeyFile)
	}

	info, err := os.Stat(s.keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("key permissions = %#o, want 0600", got)
		}
	}

	s.data = testData()
	if err := s.save(); err != nil {
		t.Fatal(err)
	}
	s.Lock()

	opened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if !opened.Unlocked() {
		t.Fatal("keyfile vault did not open unlocked")
	}
	if len(opened.data.Profiles) != 1 || opened.data.Profiles[0].ID != "home" {
		t.Fatalf("profiles = %+v", opened.data.Profiles)
	}

	if runtime.GOOS != "windows" {
		if err := os.Chmod(s.keyPath, 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := Open(path); !errors.Is(err, ErrKeyPermissions) {
			t.Fatalf("open with loose key permissions error = %v", err)
		}
	}
}

func TestLockout(t *testing.T) {
	_, path := createLocked(t, "correct horse battery staple")

	opened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}

	base := time.Unix(1_700_000_000, 0)
	opened.now = func() time.Time { return base }

	for i := 0; i < 3; i++ {
		if err := opened.Unlock("wrong"); !errors.Is(err, ErrWrongPassword) {
			t.Fatalf("attempt %d error = %v", i+1, err)
		}
	}
	if err := opened.Unlock("correct horse battery staple"); !errors.Is(err, ErrLockedOut) {
		t.Fatalf("locked-out error = %v", err)
	}

	opened.now = func() time.Time { return base.Add(2 * time.Second) }
	if err := opened.Unlock("correct horse battery staple"); err != nil {
		t.Fatal(err)
	}
}

func TestVaultDoesNotStorePlaintext(t *testing.T) {
	const secret = "SUPER_SECRET_PRIVATE_KEY"

	path := filepath.Join(t.TempDir(), "vault.json")
	s, err := Create(path, "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	s.data = Data{
		Version: formatVersion,
		Profiles: []Profile{{
			ID:           "home",
			Name:         "Home",
			TunnelConfig: "PrivateKey = " + secret,
			DashboardURL: "http://192.168.1.10:8080",
		}},
	}
	if err := s.save(); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), secret) {
		t.Fatal("vault file contains the plaintext tunnel config")
	}
}

func TestTamperedKDFParams(t *testing.T) {
	_, path := createLocked(t, "correct horse battery staple")

	var meta metadata
	if err := readJSON(path, &meta); err != nil {
		t.Fatal(err)
	}
	meta.KDF.Memory = 0
	if err := writeJSONAtomic(path, meta, 0o600); err != nil {
		t.Fatal(err)
	}

	opened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := opened.Unlock("correct horse battery staple"); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("error = %v, want ErrCorrupt", err)
	}
}

func TestCreateRefusesExisting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "vault.json")
	if _, err := Create(path, "first"); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(path, "second"); !errors.Is(err, ErrExists) {
		t.Fatalf("error = %v, want ErrExists", err)
	}
}
