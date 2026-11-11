package app

import (
	"context"
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
	ExternalMode    string
	ExternalOrigins []string
}

type App struct {
	tunnel *tunnel.Device
	proxy  *proxy.Server
	addr   net.Addr
	once   sync.Once
}

func Start(cfg config.Tunnel, opts Options) (*App, error) {
	mode, err := external.NormalizeMode(opts.ExternalMode, opts.AllowExternal)
	if err != nil {
		return nil, err
	}
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
		Mode:    mode,
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

// DialContext opens a TCP connection through the userspace tunnel. It is used
// for reachability checks that should not go through the HTTP proxy.
func (a *App) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return a.tunnel.DialContext(ctx, network, address)
}

func (a *App) Close() error {
	a.once.Do(func() {
		a.proxy.Close()
		a.tunnel.Close()
	})
	return nil
}
