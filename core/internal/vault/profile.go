package vault

import (
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/external"
)

var (
	ErrProfileExists   = errors.New("profile already exists")
	ErrProfileNotFound = errors.New("profile not found")
	ErrInvalidProfile  = errors.New("invalid profile")
)

type Profile struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	TunnelConfig    string   `json:"tunnel_config"`
	DashboardURL    string   `json:"dashboard_url"`
	AllowExternal   bool     `json:"allow_external"`
	ExternalOrigins []string `json:"external_origins,omitempty"`
}

type Data struct {
	Version       int       `json:"version"`
	ActiveProfile string    `json:"active_profile,omitempty"`
	Profiles      []Profile `json:"profiles"`
}

func (p Profile) Validate() error {
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("%w: name is required", ErrInvalidProfile)
	}
	if _, err := config.ParseTunnel(p.TunnelConfig); err != nil {
		return fmt.Errorf("%w: tunnel: %v", ErrInvalidProfile, err)
	}
	if err := (config.App{DashboardURL: p.DashboardURL}).Validate(); err != nil {
		return fmt.Errorf("%w: dashboard: %v", ErrInvalidProfile, err)
	}
	if _, err := external.ParseAll(p.ExternalOrigins); err != nil {
		return fmt.Errorf("%w: external origin: %v", ErrInvalidProfile, err)
	}
	return nil
}

func (s *Store) Profiles() []Profile {
	if !s.unlocked {
		return nil
	}
	out := make([]Profile, len(s.data.Profiles))
	for i, p := range s.data.Profiles {
		out[i] = cloneProfile(p)
	}
	return out
}

func (s *Store) Profile(id string) (Profile, bool) {
	if !s.unlocked {
		return Profile{}, false
	}
	index := s.findProfile(id)
	if index < 0 {
		return Profile{}, false
	}
	return cloneProfile(s.data.Profiles[index]), true
}

func (s *Store) ActiveProfile() (Profile, bool) {
	if !s.unlocked {
		return Profile{}, false
	}

	index := s.findProfile(s.data.ActiveProfile)
	if index < 0 && len(s.data.Profiles) > 0 {
		index = 0
	}
	if index < 0 {
		return Profile{}, false
	}
	return cloneProfile(s.data.Profiles[index]), true
}

func (s *Store) AddProfile(p Profile) (Profile, error) {
	if !s.unlocked {
		return Profile{}, ErrLocked
	}

	p.Name = strings.TrimSpace(p.Name)
	if strings.TrimSpace(p.ID) == "" {
		id, err := randomProfileID()
		if err != nil {
			return Profile{}, err
		}
		p.ID = id
	}
	if s.findProfile(p.ID) >= 0 {
		return Profile{}, ErrProfileExists
	}
	if err := p.Validate(); err != nil {
		return Profile{}, err
	}

	s.data.Profiles = append(s.data.Profiles, cloneProfile(p))
	if s.data.ActiveProfile == "" {
		s.data.ActiveProfile = p.ID
	}
	if err := s.save(); err != nil {
		return Profile{}, err
	}
	return cloneProfile(p), nil
}

func (s *Store) UpdateProfile(p Profile) error {
	if !s.unlocked {
		return ErrLocked
	}

	p.Name = strings.TrimSpace(p.Name)
	index := s.findProfile(p.ID)
	if index < 0 {
		return ErrProfileNotFound
	}
	if err := p.Validate(); err != nil {
		return err
	}

	s.data.Profiles[index] = cloneProfile(p)
	return s.save()
}

func (s *Store) DeleteProfile(id string) error {
	if !s.unlocked {
		return ErrLocked
	}

	index := s.findProfile(id)
	if index < 0 {
		return ErrProfileNotFound
	}

	copy(s.data.Profiles[index:], s.data.Profiles[index+1:])
	s.data.Profiles[len(s.data.Profiles)-1] = Profile{}
	s.data.Profiles = s.data.Profiles[:len(s.data.Profiles)-1]
	if s.data.ActiveProfile == id {
		s.data.ActiveProfile = ""
		if len(s.data.Profiles) > 0 {
			s.data.ActiveProfile = s.data.Profiles[0].ID
		}
	}
	return s.save()
}

func (s *Store) SetActiveProfile(id string) error {
	if !s.unlocked {
		return ErrLocked
	}
	if s.findProfile(id) < 0 {
		return ErrProfileNotFound
	}

	s.data.ActiveProfile = id
	return s.save()
}

func (s *Store) findProfile(id string) int {
	for i, p := range s.data.Profiles {
		if p.ID == id {
			return i
		}
	}
	return -1
}

func randomProfileID() (string, error) {
	b, err := randomBytes(8)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func cloneProfile(p Profile) Profile {
	p.ExternalOrigins = append([]string(nil), p.ExternalOrigins...)
	return p
}
