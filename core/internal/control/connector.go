package control

import (
	"sync"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/app"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
)

type Connector interface {
	Connect(cfg config.Tunnel) (proxyAddr string, err error)
	Disconnect() error
}

type AppConnector struct {
	mu      sync.Mutex
	current *app.App
}

func NewAppConnector() *AppConnector {
	return &AppConnector{}
}

func (c *AppConnector) Connect(cfg config.Tunnel) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.current != nil {
		_ = c.current.Close()
		c.current = nil
	}

	instance, err := app.Start(cfg)
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
