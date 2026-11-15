package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net"
	"sync"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/external"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/proxy"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/tunnel"
)

// Options controls which non-LAN origins, if any, may bypass the tunnel.
type Options struct {
	AllowExternal     bool
	ExternalMode      string
	ExternalOrigins   []string
	AllowHTTPExternal bool
	RequireProxyAuth  bool
}

type App struct {
	tunnel    *tunnel.Device
	proxy     *proxy.Server
	addr      net.Addr
	proxyAuth string
	once      sync.Once
}

func randomProxyToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
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

	authToken := ""
	if opts.RequireProxyAuth {
		authToken, err = randomProxyToken()
		if err != nil {
			device.Close()
			return nil, err
		}
	}

	policy := proxy.ExternalPolicy{
		Mode:              mode,
		Origins:           origins,
		AllowHTTPExternal: opts.AllowHTTPExternal,
	}
	server := proxy.New(device, proxy.DirectDialer{}, policy, proxy.Options{
		AuthToken: authToken,
	})
	addr, err := server.Start()
	if err != nil {
		device.Close()
		return nil, err
	}

	return &App{
		tunnel:    device,
		proxy:     server,
		addr:      addr,
		proxyAuth: authToken,
	}, nil
}

func (a *App) ProxyAddr() net.Addr {
	return a.addr
}

// ProxyAuth returns the per-run proxy token, or an empty string when the
// proxy does not require authentication.
func (a *App) ProxyAuth() string {
	return a.proxyAuth
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
