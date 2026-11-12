package vault

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

var (
	ErrCredentialExists   = errors.New("credential already exists")
	ErrCredentialNotFound = errors.New("credential not found")
	ErrInvalidCredential  = errors.New("invalid credential")
)

// Credential is one saved dashboard login. Passwords live only in the
// encrypted vault and are never part of a profile summary.
type Credential struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	URL      string `json:"url,omitempty"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

func (c Credential) Validate() error {
	if strings.TrimSpace(c.ID) == "" {
		return fmt.Errorf("%w: id is required", ErrInvalidCredential)
	}
	if strings.TrimSpace(c.Name) == "" {
		return fmt.Errorf("%w: name is required", ErrInvalidCredential)
	}
	if c.Password == "" {
		return fmt.Errorf("%w: password is required", ErrInvalidCredential)
	}
	if c.URL != "" {
		parsed, err := url.Parse(c.URL)
		if err != nil || parsed.Host == "" || parsed.User != nil ||
			(parsed.Scheme != "http" && parsed.Scheme != "https") {
			return fmt.Errorf("%w: url must be an http or https address without userinfo", ErrInvalidCredential)
		}
	}
	return nil
}

// Credentials returns a copy of a profile's saved logins. The bool is false
// when the profile does not exist.
func (s *Store) Credentials(profileID string) ([]Credential, bool) {
	if !s.unlocked {
		return nil, false
	}
	index := s.findProfile(profileID)
	if index < 0 {
		return nil, false
	}
	credentials := s.data.Profiles[index].Credentials
	out := make([]Credential, len(credentials))
	copy(out, credentials)
	return out, true
}

func (s *Store) Credential(profileID, credentialID string) (Credential, bool) {
	if !s.unlocked {
		return Credential{}, false
	}
	profileIndex := s.findProfile(profileID)
	if profileIndex < 0 {
		return Credential{}, false
	}
	credentialIndex := s.findCredential(profileIndex, credentialID)
	if credentialIndex < 0 {
		return Credential{}, false
	}
	return s.data.Profiles[profileIndex].Credentials[credentialIndex], true
}

func (s *Store) AddCredential(profileID string, credential Credential) (Credential, error) {
	if !s.unlocked {
		return Credential{}, ErrLocked
	}
	profileIndex := s.findProfile(profileID)
	if profileIndex < 0 {
		return Credential{}, ErrProfileNotFound
	}

	credential.Name = strings.TrimSpace(credential.Name)
	credential.URL = strings.TrimSpace(credential.URL)
	credential.Username = strings.TrimSpace(credential.Username)
	if credential.ID == "" {
		id, err := randomID()
		if err != nil {
			return Credential{}, err
		}
		credential.ID = id
	}
	if s.findCredential(profileIndex, credential.ID) >= 0 {
		return Credential{}, ErrCredentialExists
	}
	if err := credential.Validate(); err != nil {
		return Credential{}, err
	}

	s.data.Profiles[profileIndex].Credentials = append(
		s.data.Profiles[profileIndex].Credentials,
		credential,
	)
	if err := s.save(); err != nil {
		return Credential{}, err
	}
	return credential, nil
}

// UpdateCredential keeps the stored password when the input password is
// empty, so the editor can leave the field blank.
func (s *Store) UpdateCredential(profileID string, credential Credential) (Credential, error) {
	if !s.unlocked {
		return Credential{}, ErrLocked
	}
	profileIndex := s.findProfile(profileID)
	if profileIndex < 0 {
		return Credential{}, ErrProfileNotFound
	}
	credentialIndex := s.findCredential(profileIndex, credential.ID)
	if credentialIndex < 0 {
		return Credential{}, ErrCredentialNotFound
	}

	existing := s.data.Profiles[profileIndex].Credentials[credentialIndex]
	existing.Name = strings.TrimSpace(credential.Name)
	existing.URL = strings.TrimSpace(credential.URL)
	existing.Username = strings.TrimSpace(credential.Username)
	if credential.Password != "" {
		existing.Password = credential.Password
	}
	if err := existing.Validate(); err != nil {
		return Credential{}, err
	}

	s.data.Profiles[profileIndex].Credentials[credentialIndex] = existing
	if err := s.save(); err != nil {
		return Credential{}, err
	}
	return existing, nil
}

func (s *Store) DeleteCredential(profileID, credentialID string) error {
	if !s.unlocked {
		return ErrLocked
	}
	profileIndex := s.findProfile(profileID)
	if profileIndex < 0 {
		return ErrProfileNotFound
	}
	credentialIndex := s.findCredential(profileIndex, credentialID)
	if credentialIndex < 0 {
		return ErrCredentialNotFound
	}

	credentials := s.data.Profiles[profileIndex].Credentials
	copy(credentials[credentialIndex:], credentials[credentialIndex+1:])
	credentials[len(credentials)-1] = Credential{}
	s.data.Profiles[profileIndex].Credentials = credentials[:len(credentials)-1]
	return s.save()
}

func (s *Store) findCredential(profileIndex int, credentialID string) int {
	for i, credential := range s.data.Profiles[profileIndex].Credentials {
		if credential.ID == credentialID {
			return i
		}
	}
	return -1
}
