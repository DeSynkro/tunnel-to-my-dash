package vault

import (
	"errors"
	"path/filepath"
	"testing"
)

func newCredential(name string) Credential {
	return Credential{
		Name:     name,
		URL:      "http://192.168.1.11:3000",
		Username: "alex",
		Password: "hunter2",
	}
}

func TestCredentialCRUD(t *testing.T) {
	s, _ := newKeyFileVault(t)
	home, err := s.AddProfile(newProfile(t, "Home"))
	if err != nil {
		t.Fatal(err)
	}
	office, err := s.AddProfile(newProfile(t, "Office"))
	if err != nil {
		t.Fatal(err)
	}

	credential, err := s.AddCredential(home.ID, newCredential("Jellyfin"))
	if err != nil {
		t.Fatal(err)
	}
	if len(credential.ID) != 16 {
		t.Fatalf("credential ID = %q, want 16 hex characters", credential.ID)
	}

	list, ok := s.Credentials(home.ID)
	if !ok || len(list) != 1 || list[0].Name != "Jellyfin" {
		t.Fatalf("credentials = %+v, ok = %v", list, ok)
	}
	list[0].Name = "changed"
	again, _ := s.Credentials(home.ID)
	if again[0].Name != "Jellyfin" {
		t.Fatal("Credentials returned the stored slice instead of a copy")
	}

	secret, ok := s.Credential(home.ID, credential.ID)
	if !ok || secret.Username != "alex" || secret.Password != "hunter2" {
		t.Fatalf("credential = %+v, ok = %v", secret, ok)
	}
	if _, ok := s.Credential(office.ID, credential.ID); ok {
		t.Fatal("found the credential under the wrong profile")
	}
	if _, ok := s.Credential(home.ID, "missing"); ok {
		t.Fatal("found a missing credential")
	}

	updated, err := s.UpdateCredential(home.ID, Credential{
		ID:       credential.ID,
		Name:     "Jellyfin 2",
		Username: "sam",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Password != "hunter2" {
		t.Fatalf("password changed on a blank update: %q", updated.Password)
	}
	if updated.Name != "Jellyfin 2" || updated.Username != "sam" {
		t.Fatalf("updated credential = %+v", updated)
	}

	updated, err = s.UpdateCredential(home.ID, Credential{
		ID:       credential.ID,
		Name:     "Jellyfin 2",
		Username: "sam",
		Password: "new-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Password != "new-secret" {
		t.Fatalf("password = %q", updated.Password)
	}

	other, ok := s.Credentials(office.ID)
	if !ok || len(other) != 0 {
		t.Fatalf("office credentials = %+v, ok = %v", other, ok)
	}

	if err := s.DeleteCredential(home.ID, credential.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCredential(home.ID, credential.ID); !errors.Is(err, ErrCredentialNotFound) {
		t.Fatalf("second delete error = %v", err)
	}

	if _, err := s.AddCredential("missing", newCredential("x")); !errors.Is(err, ErrProfileNotFound) {
		t.Fatalf("missing profile error = %v", err)
	}
}

func TestCredentialValidation(t *testing.T) {
	s, _ := newKeyFileVault(t)
	home, err := s.AddProfile(newProfile(t, "Home"))
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name       string
		credential Credential
	}{
		{"no name", Credential{ID: "test", Password: "x"}},
		{"no password", Credential{ID: "test", Name: "Home"}},
		{"bad scheme", Credential{ID: "test", Name: "Home", URL: "ftp://192.168.1.11", Password: "x"}},
		{"no host", Credential{ID: "test", Name: "Home", URL: "https://", Password: "x"}},
		{
			"userinfo",
			Credential{
				ID:       "test",
				Name:     "Home",
				URL:      "https://user:pass@192.168.1.11",
				Password: "x",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := s.AddCredential(home.ID, test.credential); !errors.Is(err, ErrInvalidCredential) {
				t.Fatalf("error = %v, want ErrInvalidCredential", err)
			}
		})
	}

	if _, err := s.AddCredential(home.ID, Credential{
		Name:     "Home",
		URL:      "https://dash.example.com",
		Password: "spaces are fine ",
	}); err != nil {
		t.Fatalf("valid https credential: %v", err)
	}
}

func TestCredentialDeleteProfileCascades(t *testing.T) {
	s, _ := newKeyFileVault(t)
	home, err := s.AddProfile(newProfile(t, "Home"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddCredential(home.ID, newCredential("Jellyfin")); err != nil {
		t.Fatal(err)
	}

	if err := s.DeleteProfile(home.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Credentials(home.ID); ok {
		t.Fatal("credentials survived their profile")
	}
}

func TestCredentialLocked(t *testing.T) {
	s, _ := newKeyFileVault(t)
	home, err := s.AddProfile(newProfile(t, "Home"))
	if err != nil {
		t.Fatal(err)
	}
	credential, err := s.AddCredential(home.ID, newCredential("Jellyfin"))
	if err != nil {
		t.Fatal(err)
	}

	s.Lock()
	if _, ok := s.Credentials(home.ID); ok {
		t.Fatal("Credentials returned data while locked")
	}
	if _, ok := s.Credential(home.ID, credential.ID); ok {
		t.Fatal("Credential returned data while locked")
	}
	if _, err := s.AddCredential(home.ID, newCredential("x")); !errors.Is(err, ErrLocked) {
		t.Fatalf("add error = %v", err)
	}
	if _, err := s.UpdateCredential(home.ID, credential); !errors.Is(err, ErrLocked) {
		t.Fatalf("update error = %v", err)
	}
	if err := s.DeleteCredential(home.ID, credential.ID); !errors.Is(err, ErrLocked) {
		t.Fatalf("delete error = %v", err)
	}
}

func TestCredentialExportImport(t *testing.T) {
	s, _ := newKeyFileVault(t)
	home, err := s.AddProfile(newProfile(t, "Home"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddCredential(home.ID, newCredential("Jellyfin")); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "backup.ttmd")
	if err := s.Export(path, "backup password"); err != nil {
		t.Fatal(err)
	}
	data, err := ReadExport(path, "backup password")
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Profiles) != 1 || len(data.Profiles[0].Credentials) != 1 {
		t.Fatalf("exported profile = %+v", data.Profiles)
	}
	if data.Profiles[0].Credentials[0].Password != "hunter2" {
		t.Fatal("export dropped the saved password")
	}

	dst, _ := newKeyFileVault(t)
	if err := dst.Import(path, "backup password"); err != nil {
		t.Fatal(err)
	}
	imported := dst.Profiles()
	if len(imported) != 1 || len(imported[0].Credentials) != 1 {
		t.Fatalf("imported profile = %+v", imported)
	}
	if imported[0].Credentials[0].Name != "Jellyfin" {
		t.Fatalf("imported credential = %+v", imported[0].Credentials[0])
	}
}
