package vault

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
)

const exportVersion = 1

type exportFile struct {
	Version    int     `json:"version"`
	KDF        kdfMeta `json:"kdf"`
	Nonce      string  `json:"nonce"`
	Ciphertext string  `json:"ciphertext"`
}

func (s *Store) Export(path, password string) error {
	if !s.unlocked {
		return ErrLocked
	}
	if samePath(path, s.path) || samePath(path, s.keyPath) {
		return errors.New("export path must differ from the vault paths")
	}

	payload, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	salt, err := randomBytes(saltSize)
	if err != nil {
		return err
	}
	nonce, err := randomBytes(nonceSize)
	if err != nil {
		return err
	}

	ciphertext, err := seal(deriveKey(password, salt, defaultKDF), nonce, payload, exportAAD)
	if err != nil {
		return err
	}

	f := exportFile{
		Version: exportVersion,
		KDF: kdfMeta{
			Name:    "argon2id",
			Time:    defaultKDF.Time,
			Memory:  defaultKDF.Memory,
			Threads: defaultKDF.Threads,
			Salt:    b64(salt),
		},
		Nonce:      b64(nonce),
		Ciphertext: b64(ciphertext),
	}
	return writeJSONAtomic(path, f, 0o600)
}

func ReadExport(path, password string) (Data, error) {
	var f exportFile
	if err := readJSON(path, &f); err != nil {
		return Data{}, err
	}
	if f.Version != exportVersion || f.KDF.Name != "argon2id" {
		return Data{}, ErrUnsupportedVersion
	}

	params := kdfParams{
		Time:    f.KDF.Time,
		Memory:  f.KDF.Memory,
		Threads: f.KDF.Threads,
	}
	if !validKDF(params) {
		return Data{}, fmt.Errorf("%w: invalid KDF parameters", ErrCorrupt)
	}

	salt, err := unb64(f.KDF.Salt)
	if err != nil {
		return Data{}, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	nonce, err := unb64(f.Nonce)
	if err != nil {
		return Data{}, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	ciphertext, err := unb64(f.Ciphertext)
	if err != nil {
		return Data{}, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}

	plaintext, err := openSealed(deriveKey(password, salt, params), nonce, ciphertext, exportAAD)
	if err != nil {
		return Data{}, ErrWrongPassword
	}

	var data Data
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return Data{}, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	if data.Version != formatVersion {
		return Data{}, ErrUnsupportedVersion
	}
	for _, p := range data.Profiles {
		if p.ID == "" {
			return Data{}, fmt.Errorf("%w: profile ID is required", ErrInvalidProfile)
		}
		if err := p.Validate(); err != nil {
			return Data{}, err
		}
	}

	return data, nil
}

func (s *Store) Import(path, password string) error {
	if !s.unlocked {
		return ErrLocked
	}

	data, err := ReadExport(path, password)
	if err != nil {
		return err
	}

	merged := make([]Profile, len(s.data.Profiles), len(s.data.Profiles)+len(data.Profiles))
	copy(merged, s.data.Profiles)

	seen := make(map[string]bool, len(merged)+len(data.Profiles))
	for _, p := range merged {
		seen[p.ID] = true
	}
	for _, p := range data.Profiles {
		if seen[p.ID] {
			return ErrProfileExists
		}
		seen[p.ID] = true
		merged = append(merged, cloneProfile(p))
	}

	active := s.data.ActiveProfile
	if active == "" {
		if seen[data.ActiveProfile] {
			active = data.ActiveProfile
		} else if len(merged) > 0 {
			active = merged[0].ID
		}
	}

	s.data.Profiles = merged
	s.data.ActiveProfile = active
	return s.save()
}

func samePath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	aAbs, errA := filepath.Abs(a)
	bAbs, errB := filepath.Abs(b)
	if errA != nil || errB != nil {
		return filepath.Clean(a) == filepath.Clean(b)
	}
	return aAbs == bAbs
}
