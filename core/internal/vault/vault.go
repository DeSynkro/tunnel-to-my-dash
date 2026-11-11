package vault

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const formatVersion = 1

const (
	modePassword = "password"
	modeKeyFile  = "keyfile"
)

var (
	ErrExists             = errors.New("vault already exists")
	ErrLocked             = errors.New("vault is locked")
	ErrWrongPassword      = errors.New("wrong password")
	ErrLockedOut          = errors.New("too many failed attempts; try again later")
	ErrCorrupt            = errors.New("vault is damaged or was tampered with")
	ErrKeyPermissions     = errors.New("vault key file permissions are too open")
	ErrUnsupportedVersion = errors.New("unsupported vault version")
)

type kdfMeta struct {
	Name    string `json:"name"`
	Time    uint32 `json:"time"`
	Memory  uint32 `json:"memory"`
	Threads uint8  `json:"threads"`
	Salt    string `json:"salt"`
}

type metadata struct {
	Version    int      `json:"version"`
	Mode       string   `json:"mode"`
	KDF        *kdfMeta `json:"kdf,omitempty"`
	WrappedKey string   `json:"wrapped_key,omitempty"`
	WrapNonce  string   `json:"wrap_nonce,omitempty"`
	Nonce      string   `json:"nonce"`
	Ciphertext string   `json:"ciphertext"`
}

type Store struct {
	path        string
	keyPath     string
	meta        metadata
	key         [keySize]byte
	data        Data
	unlocked    bool
	failures    int
	lockedUntil time.Time
	now         func() time.Time
}

func Create(path, password string) (*Store, error) {
	if _, err := os.Stat(path); err == nil {
		return nil, ErrExists
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	keyBytes, err := randomBytes(keySize)
	if err != nil {
		return nil, err
	}

	s := &Store{
		path:     path,
		keyPath:  keyFilePath(path),
		data:     Data{Version: formatVersion, Profiles: []Profile{}},
		unlocked: true,
		now:      time.Now,
	}
	copy(s.key[:], keyBytes)
	s.meta.Version = formatVersion
	s.meta.Mode = modePassword

	if password == "" {
		s.meta.Mode = modeKeyFile
		if err := s.writeKeyFile(); err != nil {
			return nil, err
		}
	} else if err := s.setPassword(password); err != nil {
		return nil, err
	}

	if err := s.save(); err != nil {
		if s.meta.Mode == modeKeyFile {
			_ = os.Remove(s.keyPath)
		}
		return nil, err
	}

	return s, nil
}

func Open(path string) (*Store, error) {
	var meta metadata
	if err := readJSON(path, &meta); err != nil {
		return nil, err
	}
	if meta.Version != formatVersion {
		return nil, ErrUnsupportedVersion
	}

	s := &Store{
		path:    path,
		keyPath: keyFilePath(path),
		meta:    meta,
		now:     time.Now,
	}

	switch meta.Mode {
	case modePassword:
		if meta.KDF == nil || meta.WrappedKey == "" || meta.WrapNonce == "" || meta.Nonce == "" || meta.Ciphertext == "" {
			return nil, fmt.Errorf("%w: incomplete password vault", ErrCorrupt)
		}
		return s, nil
	case modeKeyFile:
		key, err := readKeyFile(s.keyPath)
		if err != nil {
			return nil, err
		}
		s.key = key
		if err := s.loadPayload(); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrCorrupt, err)
		}
		s.unlocked = true
		return s, nil
	default:
		return nil, fmt.Errorf("%w: unknown mode %q", ErrCorrupt, meta.Mode)
	}
}

func (s *Store) Unlock(password string) error {
	if s.unlocked {
		return nil
	}
	if s.meta.Mode != modePassword {
		return ErrLocked
	}

	now := s.now()
	if now.Before(s.lockedUntil) {
		return ErrLockedOut
	}

	keyBytes, err := s.unwrapKey(password)
	if err != nil {
		if errors.Is(err, ErrCorrupt) {
			return err
		}
		s.recordFailure()
		return ErrWrongPassword
	}
	if len(keyBytes) != keySize {
		return fmt.Errorf("%w: bad vault key length", ErrCorrupt)
	}
	copy(s.key[:], keyBytes)

	if err := s.loadPayload(); err != nil {
		s.key = [keySize]byte{}
		s.data = Data{}
		return fmt.Errorf("%w: %v", ErrCorrupt, err)
	}

	s.failures = 0
	s.lockedUntil = time.Time{}
	s.unlocked = true
	return nil
}

func (s *Store) unwrapKey(password string) ([]byte, error) {
	if s.meta.KDF == nil {
		return nil, fmt.Errorf("%w: missing KDF parameters", ErrCorrupt)
	}

	salt, err := unb64(s.meta.KDF.Salt)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	wrapped, err := unb64(s.meta.WrappedKey)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	wrapNonce, err := unb64(s.meta.WrapNonce)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}

	params := kdfParams{
		Time:    s.meta.KDF.Time,
		Memory:  s.meta.KDF.Memory,
		Threads: s.meta.KDF.Threads,
	}
	if !validKDF(params) {
		return nil, fmt.Errorf("%w: invalid KDF parameters", ErrCorrupt)
	}
	key, err := openSealed(deriveKey(password, salt, params), wrapNonce, wrapped, wrapAAD)
	if err != nil {
		return nil, ErrWrongPassword
	}
	return key, nil
}

func (s *Store) PasswordProtected() bool {
	return s.meta.Mode == modePassword
}

func (s *Store) ChangePassword(oldPassword, newPassword string) error {
	if !s.unlocked {
		return ErrLocked
	}

	oldMeta := s.meta
	oldMode := s.meta.Mode

	if oldMode == modePassword {
		if err := s.checkPassword(oldPassword); err != nil {
			return err
		}
	}

	if newPassword == "" {
		if oldMode == modeKeyFile {
			return nil
		}
		if err := s.writeKeyFile(); err != nil {
			return err
		}
		s.meta.Mode = modeKeyFile
		s.meta.KDF = nil
		s.meta.WrappedKey = ""
		s.meta.WrapNonce = ""
		if err := s.save(); err != nil {
			_ = os.Remove(s.keyPath)
			s.meta = oldMeta
			return err
		}
	} else {
		s.meta.Mode = modePassword
		if err := s.setPassword(newPassword); err != nil {
			s.meta = oldMeta
			return err
		}
		if err := s.save(); err != nil {
			s.meta = oldMeta
			return err
		}
		if oldMode == modeKeyFile {
			if err := os.Remove(s.keyPath); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("remove key file: %w", err)
			}
		}
	}

	s.failures = 0
	s.lockedUntil = time.Time{}
	return nil
}

func (s *Store) checkPassword(password string) error {
	keyBytes, err := s.unwrapKey(password)
	if err != nil {
		return err
	}
	if !bytes.Equal(keyBytes, s.key[:]) {
		return ErrWrongPassword
	}
	return nil
}

func (s *Store) Lock() {
	s.key = [keySize]byte{}
	s.data = Data{}
	s.unlocked = false
}

func (s *Store) Unlocked() bool {
	return s.unlocked
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) loadPayload() error {
	nonce, err := unb64(s.meta.Nonce)
	if err != nil {
		return err
	}
	ciphertext, err := unb64(s.meta.Ciphertext)
	if err != nil {
		return err
	}

	plaintext, err := openSealed(s.key[:], nonce, ciphertext, payloadAAD)
	if err != nil {
		return err
	}

	var data Data
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return err
	}
	if data.Version != formatVersion {
		return ErrUnsupportedVersion
	}
	s.data = data
	return nil
}

func (s *Store) save() error {
	if !s.unlocked {
		return ErrLocked
	}

	payload, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	nonce, err := randomBytes(nonceSize)
	if err != nil {
		return err
	}
	ciphertext, err := seal(s.key[:], nonce, payload, payloadAAD)
	if err != nil {
		return err
	}

	s.meta.Version = formatVersion
	s.meta.Nonce = b64(nonce)
	s.meta.Ciphertext = b64(ciphertext)

	return writeJSONAtomic(s.path, s.meta, 0o600)
}

func (s *Store) setPassword(password string) error {
	salt, err := randomBytes(saltSize)
	if err != nil {
		return err
	}
	wrapNonce, err := randomBytes(nonceSize)
	if err != nil {
		return err
	}

	key := deriveKey(password, salt, defaultKDF)
	wrapped, err := seal(key, wrapNonce, s.key[:], wrapAAD)
	if err != nil {
		return err
	}

	s.meta.KDF = &kdfMeta{
		Name:    "argon2id",
		Time:    defaultKDF.Time,
		Memory:  defaultKDF.Memory,
		Threads: defaultKDF.Threads,
		Salt:    b64(salt),
	}
	s.meta.WrappedKey = b64(wrapped)
	s.meta.WrapNonce = b64(wrapNonce)
	return nil
}

func (s *Store) writeKeyFile() error {
	return writeFileAtomic(s.keyPath, s.key[:], 0o600)
}

func (s *Store) recordFailure() {
	s.failures++
	delay := backoff(s.failures)
	s.lockedUntil = s.now().Add(delay)
}

func backoff(failures int) time.Duration {
	if failures < 3 {
		return 0
	}
	if failures > 8 {
		return 30 * time.Second
	}
	delay := time.Second << (failures - 3)
	if delay > 30*time.Second {
		return 30 * time.Second
	}
	return delay
}

func keyFilePath(path string) string {
	return filepath.Join(filepath.Dir(path), "vault.key")
}

func readKeyFile(path string) ([keySize]byte, error) {
	var key [keySize]byte

	info, err := os.Stat(path)
	if err != nil {
		return key, err
	}
	if !info.Mode().IsRegular() {
		return key, fmt.Errorf("%w: key path is not a regular file", ErrCorrupt)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return key, ErrKeyPermissions
	}

	b, err := os.ReadFile(path)
	if err != nil {
		return key, err
	}
	if len(b) != keySize {
		return key, fmt.Errorf("%w: bad key length", ErrCorrupt)
	}
	copy(key[:], b)
	return key, nil
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func writeJSONAtomic(path string, v any, perm os.FileMode) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	return writeFileAtomic(path, b, perm)
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, ".ttmd-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)

	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
