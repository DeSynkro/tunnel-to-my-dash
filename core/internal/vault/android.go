package vault

// AndroidSettings holds the Android client's UI and lifecycle preferences. It
// lives in its own vault block so desktop clients, which do not know these
// fields, preserve them when they save the shared Data structure.
type AndroidSettings struct {
	LockOnBackground         bool `json:"lock_on_background"`
	AutoConnect              bool `json:"auto_connect"`
	OpenPublicLinksInBrowser bool `json:"open_public_links_in_browser"`
}

// DefaultAndroidSettings returns the settings for a new Android vault. Lock on
// background is on by default for password-protected vaults; keyfile vaults
// hide the control and never lock the UI.
func DefaultAndroidSettings() AndroidSettings {
	return AndroidSettings{LockOnBackground: true}
}

// AndroidSettings returns the stored Android settings, or the defaults when
// the vault predates the block or is locked.
func (s *Store) AndroidSettings() AndroidSettings {
	if !s.unlocked || s.data.Android == nil {
		return DefaultAndroidSettings()
	}
	return *s.data.Android
}

// SetAndroidSettings stores the Android preferences in the vault.
func (s *Store) SetAndroidSettings(settings AndroidSettings) error {
	if !s.unlocked {
		return ErrLocked
	}
	s.data.Android = &settings
	return s.save()
}
