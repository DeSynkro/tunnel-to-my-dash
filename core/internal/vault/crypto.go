package vault

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"
)

const (
	keySize   = 32
	nonceSize = 24
	saltSize  = 16
)

var (
	payloadAAD = []byte("ttmd vault payload v1")
	wrapAAD    = []byte("ttmd vault key v1")
	exportAAD  = []byte("ttmd vault export v1")
)

type kdfParams struct {
	Time    uint32
	Memory  uint32
	Threads uint8
}

var defaultKDF = kdfParams{
	Time:    3,
	Memory:  64 * 1024,
	Threads: 2,
}

func randomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}

func deriveKey(password string, salt []byte, p kdfParams) []byte {
	return argon2.IDKey([]byte(password), salt, p.Time, p.Memory, p.Threads, keySize)
}

func seal(key, nonce, plaintext, aad []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, err
	}
	return aead.Seal(nil, nonce, plaintext, aad), nil
}

func openSealed(key, nonce, ciphertext, aad []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, nonce, ciphertext, aad)
}

func b64(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}

func unb64(s string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("decode base64: %w", err)
	}
	return b, nil
}
