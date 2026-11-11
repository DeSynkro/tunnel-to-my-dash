package vault

import (
	"errors"
	"fmt"
)

var ErrInvalidSettings = errors.New("invalid security settings")

const DefaultIdleMinutes = 15

type SecuritySettings struct {
	ForceLANOnly  bool `json:"force_lan_only"`
	LockAfterIdle bool `json:"lock_after_idle"`
	IdleMinutes   int  `json:"idle_minutes"`
}

func DefaultSecuritySettings() SecuritySettings {
	return SecuritySettings{IdleMinutes: DefaultIdleMinutes}
}

func (s SecuritySettings) Normalize() SecuritySettings {
	if !validIdleMinutes(s.IdleMinutes) {
		s.IdleMinutes = DefaultIdleMinutes
	}
	return s
}

func (s SecuritySettings) Validate() error {
	if !validIdleMinutes(s.IdleMinutes) {
		return fmt.Errorf("%w: idle minutes must be 5, 10, 15, 30 or 60", ErrInvalidSettings)
	}
	return nil
}

func validIdleMinutes(minutes int) bool {
	switch minutes {
	case 5, 10, 15, 30, 60:
		return true
	default:
		return false
	}
}

func (s *Store) SecuritySettings() SecuritySettings {
	if !s.unlocked {
		return DefaultSecuritySettings()
	}
	return s.data.Security.Normalize()
}

func (s *Store) SetSecuritySettings(settings SecuritySettings) error {
	if !s.unlocked {
		return ErrLocked
	}
	if err := settings.Validate(); err != nil {
		return err
	}

	s.data.Security = settings.Normalize()
	return s.save()
}
