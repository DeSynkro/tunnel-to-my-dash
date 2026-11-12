//go:build windows

package control

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net"
	"testing"

	"github.com/Microsoft/go-winio"
)

func testControlEndpoint(t *testing.T) string {
	t.Helper()
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatal(err)
	}
	return `\\.\pipe\ttmd-test-` + hex.EncodeToString(suffix[:])
}

func waitControl(pipePath string) bool {
	conn, err := winio.DialPipe(pipePath, nil)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func dialControl(ctx context.Context, pipePath string) (net.Conn, error) {
	return winio.DialPipeContext(ctx, pipePath)
}
