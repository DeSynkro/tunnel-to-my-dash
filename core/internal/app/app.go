package app

import (
	"net"
	"sync"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/proxy"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/tunnel"
)

type App struct {
	tunnel *tunnel.Device
	proxy  *proxy.Server
	addr   net.Addr
	once   sync.Once
}

func Start(cfg config.Tunnel) (*App, error) {
	device, err := tunnel.Start(tunnel.Config{
		PrivateKey:    cfg.PrivateKey,
		PeerPublicKey: cfg.PeerPublicKey,
		PresharedKey:  cfg.PresharedKey,
		Endpoint:      cfg.Endpoint,
		Addresses:     cfg.Addresses,
		MTU:           cfg.MTU,
		ListenPort:    cfg.ListenPort,
	})
	if err != nil {
		return nil, err
	}

	server := proxy.New(device, proxy.LANPolicy{})
	addr, err := server.Start()
	if err != nil {
		device.Close()
		return nil, err
	}

	return &App{
		tunnel: device,
		proxy:  server,
		addr:   addr,
	}, nil
}

func (a *App) ProxyAddr() net.Addr {
	return a.addr
}

func (a *App) Close() error {
	a.once.Do(func() {
		a.proxy.Close()
		a.tunnel.Close()
	})
	return nil
}
