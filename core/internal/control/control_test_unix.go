//go:build !windows

package control

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
)

func testControlEndpoint(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "control.sock")
}

func waitControl(socketPath string) bool {
	_, err := os.Stat(socketPath)
	return err == nil
}

func dialControl(ctx context.Context, socketPath string) (net.Conn, error) {
	var dialer net.Dialer
	return dialer.DialContext(ctx, "unix", socketPath)
}
