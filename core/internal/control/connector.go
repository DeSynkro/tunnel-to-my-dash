package control

import (
	"sync"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/app"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
)

type ConnectOptions struct {
	Tunnel          config.Tunnel
	AllowExternal   bool
	ExternalMode    string
	ExternalOrigins []string
}

type Connector interface {
	Connect(opts ConnectOptions) (proxyAddr string, err error)
	Disconnect() error
}

type AppConnector struct {
	mu      sync.Mutex
	current *app.App
}

func NewAppConnector() *AppConnector {
	return &AppConnector{}
}

func (c *AppConnector) Connect(opts ConnectOptions) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.current != nil {
		_ = c.current.Close()
		c.current = nil
	}

	instance, err := app.Start(opts.Tunnel, app.Options{
		AllowExternal:   opts.AllowExternal,
		ExternalMode:    opts.ExternalMode,
		ExternalOrigins: opts.ExternalOrigins,
	})
	if err != nil {
		return "", err
	}
	c.current = instance
	return instance.ProxyAddr().String(), nil
}

func (c *AppConnector) Disconnect() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.current == nil {
		return nil
	}
	err := c.current.Close()
	c.current = nil
	return err
}
