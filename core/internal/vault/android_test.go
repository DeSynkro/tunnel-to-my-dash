package vault

import "testing"

func TestAndroidSettingsDefaultsAndPersistence(t *testing.T) {
	store, path := newKeyFileVault(t)

	if got, want := store.AndroidSettings(), DefaultAndroidSettings(); got != want {
		t.Fatalf("default Android settings = %+v, want %+v", got, want)
	}
	if !DefaultAndroidSettings().LockOnBackground {
		t.Fatal("default LockOnBackground = false, want true")
	}

	want := AndroidSettings{
		LockOnBackground:         false,
		AutoConnect:              true,
		OpenPublicLinksInBrowser: true,
	}
	if err := store.SetAndroidSettings(want); err != nil {
		t.Fatal(err)
	}
	if got := store.AndroidSettings(); got != want {
		t.Fatalf("Android settings = %+v, want %+v", got, want)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.AndroidSettings(); got != want {
		t.Fatalf("reopened Android settings = %+v, want %+v", got, want)
	}
}

func TestSecurityUpdatePreservesAndroidSettings(t *testing.T) {
	store, _ := newKeyFileVault(t)

	want := AndroidSettings{AutoConnect: true, OpenPublicLinksInBrowser: true}
	if err := store.SetAndroidSettings(want); err != nil {
		t.Fatal(err)
	}

	settings := store.SecuritySettings()
	settings.ForceLANOnly = true
	if err := store.SetSecuritySettings(settings); err != nil {
		t.Fatal(err)
	}

	if got := store.AndroidSettings(); got != want {
		t.Fatalf("Android settings after security update = %+v, want %+v", got, want)
	}
}
