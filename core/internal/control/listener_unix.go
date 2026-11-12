//go:build !windows

package control

import (
	"errors"
	"net"
	"os"
	"path/filepath"
)

func listenControl(socketPath string) (net.Listener, func(), error) {
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o700); err != nil {
		return nil, nil, err
	}
	if err := os.Remove(socketPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, nil, err
	}

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, nil, err
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		listener.Close()
		os.Remove(socketPath)
		return nil, nil, err
	}

	cleanup := func() {
		listener.Close()
		os.Remove(socketPath)
	}
	return listener, cleanup, nil
}
