package mobile

import (
	"errors"
	"sync"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/app"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
)

var (
	mu     sync.Mutex
	active *app.App
)

// Start parses a WireGuard configuration, starts the userspace tunnel and the
// local HTTP proxy, and returns the proxy address (127.0.0.1:port).
func Start(tunnelConfig string) (string, error) {
	mu.Lock()
	defer mu.Unlock()

	if active != nil {
		return "", errors.New("the tunnel is already running")
	}
	cfg, err := config.ParseTunnel(tunnelConfig)
	if err != nil {
		return "", err
	}
	instance, err := app.Start(cfg, app.Options{})
	if err != nil {
		return "", err
	}
	active = instance
	return instance.ProxyAddr().String(), nil
}

// Stop closes the tunnel and proxy. It is safe to call when stopped.
func Stop() error {
	mu.Lock()
	defer mu.Unlock()

	if active == nil {
		return nil
	}
	err := active.Close()
	active = nil
	return err
}

// Version is a small check that the Go library loaded.
func Version() string {
	return "0.1.0"
}
