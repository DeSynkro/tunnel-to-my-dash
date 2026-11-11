package app

import (
	"net"
	"sync"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/external"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/proxy"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/tunnel"
)

// Options controls which non-LAN origins, if any, may bypass the tunnel.
type Options struct {
	AllowExternal   bool
	ExternalOrigins []string
}

type App struct {
	tunnel *tunnel.Device
	proxy  *proxy.Server
	addr   net.Addr
	once   sync.Once
}

func Start(cfg config.Tunnel, opts Options) (*App, error) {
	origins, err := external.ParseAll(opts.ExternalOrigins)
	if err != nil {
		return nil, err
	}

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

	policy := proxy.ExternalPolicy{
		Allow:   opts.AllowExternal,
		Origins: origins,
	}
	server := proxy.New(device, proxy.DirectDialer{}, policy)
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
