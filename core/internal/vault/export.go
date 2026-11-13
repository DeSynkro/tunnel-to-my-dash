package vault

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const exportVersion = 1

type exportFile struct {
	Version    int     `json:"version"`
	KDF        kdfMeta `json:"kdf"`
	Nonce      string  `json:"nonce"`
	Ciphertext string  `json:"ciphertext"`
}

// ExportBytes encrypts the vault payload into the portable export format.
func (s *Store) ExportBytes(password string) ([]byte, error) {
	if !s.unlocked {
		return nil, ErrLocked
	}

	payload, err := json.Marshal(s.data)
	if err != nil {
		return nil, err
	}
	salt, err := randomBytes(saltSize)
	if err != nil {
		return nil, err
	}
	nonce, err := randomBytes(nonceSize)
	if err != nil {
		return nil, err
	}

	ciphertext, err := seal(deriveKey(password, salt, defaultKDF), nonce, payload, exportAAD)
	if err != nil {
		return nil, err
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
	return json.Marshal(f)
}

// Export writes the encrypted portable export format to path.
func (s *Store) Export(path, password string) error {
	if samePath(path, s.path) || samePath(path, s.keyPath) {
		return errors.New("export path must differ from the vault paths")
	}

	data, err := s.ExportBytes(password)
	if err != nil {
		return err
	}
	return writeFileAtomic(path, data, 0o600)
}

// ReadExportBytes decrypts the portable export format from memory.
func ReadExportBytes(data []byte, password string) (Data, error) {
	var f exportFile
	if err := json.Unmarshal(data, &f); err != nil {
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

	var exported Data
	if err := json.Unmarshal(plaintext, &exported); err != nil {
		return Data{}, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	if exported.Version != formatVersion {
		return Data{}, ErrUnsupportedVersion
	}
	for _, p := range exported.Profiles {
		if p.ID == "" {
			return Data{}, fmt.Errorf("%w: profile ID is required", ErrInvalidProfile)
		}
		if err := p.Validate(); err != nil {
			return Data{}, err
		}
	}

	return exported, nil
}

// ReadExport decrypts the portable export format from a file.
func ReadExport(path, password string) (Data, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Data{}, err
	}
	return ReadExportBytes(data, password)
}

// ImportBytes merges an encrypted portable export into this vault.
func (s *Store) ImportBytes(data []byte, password string) error {
	if !s.unlocked {
		return ErrLocked
	}

	imported, err := ReadExportBytes(data, password)
	if err != nil {
		return err
	}

	merged := make([]Profile, len(s.data.Profiles), len(s.data.Profiles)+len(imported.Profiles))
	copy(merged, s.data.Profiles)

	seen := make(map[string]bool, len(merged)+len(imported.Profiles))
	for _, p := range merged {
		seen[p.ID] = true
	}
	for _, p := range imported.Profiles {
		if seen[p.ID] {
			return ErrProfileExists
		}
		seen[p.ID] = true
		merged = append(merged, cloneProfile(p))
	}

	active := s.data.ActiveProfile
	if active == "" {
		if seen[imported.ActiveProfile] {
			active = imported.ActiveProfile
		} else if len(merged) > 0 {
			active = merged[0].ID
		}
	}

	s.data.Profiles = merged
	s.data.ActiveProfile = active
	return s.save()
}

// Import reads and merges an encrypted portable export from a file.
func (s *Store) Import(path, password string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return s.ImportBytes(data, password)
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
