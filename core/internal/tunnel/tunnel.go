package tunnel

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/lan"
	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
)

const defaultMTU = 1420

type Config struct {
	PrivateKey    wgtypes.Key
	PeerPublicKey wgtypes.Key
	PresharedKey  *wgtypes.Key
	Endpoint      string
	Addresses     []net.IPNet
	MTU           int
	ListenPort    uint16
}

type Device struct {
	wg    *device.Device
	stack *stack.Stack
	once  sync.Once
}

func Start(cfg Config) (*Device, error) {
	if cfg.PrivateKey == (wgtypes.Key{}) {
		return nil, errors.New("missing private key")
	}
	if cfg.PeerPublicKey == (wgtypes.Key{}) {
		return nil, errors.New("missing peer public key")
	}
	if cfg.Endpoint == "" {
		return nil, errors.New("missing endpoint")
	}
	if len(cfg.Addresses) == 0 {
		return nil, errors.New("missing address")
	}
	if cfg.MTU == 0 {
		cfg.MTU = defaultMTU
	}
	if cfg.MTU < 576 || cfg.MTU > 65535 {
		return nil, fmt.Errorf("MTU must be between 576 and 65535")
	}
	if err := validateEndpoint(cfg.Endpoint); err != nil {
		return nil, err
	}
	endpoint, err := resolveEndpoint(cfg.Endpoint)
	if err != nil {
		return nil, err
	}
	cfg.Endpoint = endpoint

	ns, link, err := newNetstack(cfg.MTU, cfg.Addresses)
	if err != nil {
		return nil, err
	}

	tunDevice := newNetTUN(link, uint32(cfg.MTU))
	wg := device.NewDevice(tunDevice, conn.NewDefaultBind(), device.NewLogger(device.LogLevelSilent, ""))

	if err := wg.IpcSet(buildUAPI(cfg)); err != nil {
		wg.Close()
		ns.Close()
		return nil, fmt.Errorf("configure wireguard: %w", err)
	}
	if err := wg.Up(); err != nil {
		wg.Close()
		ns.Close()
		return nil, fmt.Errorf("start wireguard: %w", err)
	}

	return &Device{wg: wg, stack: ns}, nil
}

func (d *Device) Close() error {
	d.once.Do(func() {
		d.wg.Close()
		d.stack.Close()
		d.stack.Wait()
	})
	return nil
}

func buildUAPI(cfg Config) string {
	var b strings.Builder

	fmt.Fprintf(&b, "private_key=%s\n", hex.EncodeToString(cfg.PrivateKey[:]))
	fmt.Fprintf(&b, "listen_port=%d\n", cfg.ListenPort)
	b.WriteString("replace_peers=true\n")
	fmt.Fprintf(&b, "public_key=%s\n", hex.EncodeToString(cfg.PeerPublicKey[:]))
	if cfg.PresharedKey != nil {
		fmt.Fprintf(&b, "preshared_key=%s\n", hex.EncodeToString((*cfg.PresharedKey)[:]))
	}
	fmt.Fprintf(&b, "endpoint=%s\n", cfg.Endpoint)
	for _, allowed := range lan.DefaultAllowedIPs() {
		fmt.Fprintf(&b, "allowed_ip=%s\n", allowed.String())
	}
	b.WriteString("persistent_keepalive_interval=25\n")

	return b.String()
}

func resolveEndpoint(value string) (string, error) {
	host, port, err := net.SplitHostPort(value)
	if err != nil {
		return "", errors.New("invalid endpoint")
	}
	if ip := net.ParseIP(host); ip != nil {
		return net.JoinHostPort(ip.String(), port), nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return "", fmt.Errorf("resolve endpoint: %w", err)
	}
	if len(addrs) == 0 {
		return "", errors.New("resolve endpoint: no addresses")
	}

	chosen := addrs[0].IP
	for _, addr := range addrs {
		if v4 := addr.IP.To4(); v4 != nil {
			chosen = v4
			break
		}
	}
	return net.JoinHostPort(chosen.String(), port), nil
}

func validateEndpoint(value string) error {
	host, port, err := net.SplitHostPort(value)
	if err != nil {
		return errors.New("invalid endpoint")
	}
	if host == "" {
		return errors.New("endpoint is missing a host")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return errors.New("endpoint has an invalid port")
	}
	return nil
}
