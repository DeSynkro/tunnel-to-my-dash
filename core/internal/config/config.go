package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/lan"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

const (
	defaultMTU = 1420
	minMTU     = 576
	maxMTU     = 65535
)

type Tunnel struct {
	PrivateKey    wgtypes.Key
	PeerPublicKey wgtypes.Key
	PresharedKey  *wgtypes.Key
	Endpoint      string
	Addresses     []net.IPNet
	DNS           []net.IP
	MTU           int
	ListenPort    uint16
}

type App struct {
	DashboardURL  string `json:"dashboard_url"`
	AllowExternal bool   `json:"allow_external"`
}

func LoadTunnel(path string) (Tunnel, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Tunnel{}, fmt.Errorf("read tunnel config: %w", err)
	}
	return ParseTunnel(string(data))
}

func LoadApp(path string) (App, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return App{}, fmt.Errorf("read app config: %w", err)
	}

	var app App
	if err := json.Unmarshal(data, &app); err != nil {
		return App{}, fmt.Errorf("parse app config: %w", err)
	}
	if err := app.Validate(); err != nil {
		return App{}, err
	}
	return app, nil
}

func ParseTunnel(text string) (Tunnel, error) {
	p := &tunnelParser{}
	for i, raw := range strings.Split(text, "\n") {
		if err := p.parseLine(raw, i+1); err != nil {
			return Tunnel{}, err
		}
	}
	return p.finish()
}

func (a App) Validate() error {
	if strings.TrimSpace(a.DashboardURL) == "" {
		return errors.New("dashboard_url is required")
	}

	u, err := url.Parse(a.DashboardURL)
	if err != nil {
		return errors.New("dashboard_url is not a valid URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("dashboard_url must use http or https")
	}
	if u.User != nil {
		return errors.New("dashboard_url must not contain credentials")
	}

	host := u.Hostname()
	if host == "" {
		return errors.New("dashboard_url is missing a host")
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return errors.New("dashboard_url must use a LAN IP address; hostnames are not supported yet")
	}
	if !lan.IsLAN(ip) {
		return errors.New("dashboard_url must point to a private LAN address")
	}

	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return errors.New("dashboard_url has an invalid port")
		}
	}
	return nil
}

type tunnelParser struct {
	cfg           Tunnel
	section       string
	seenInterface bool
	seenPeer      bool
	havePrivate   bool
	havePeerKey   bool
	haveEndpoint  bool
	mtu           int
}

func (p *tunnelParser) parseLine(raw string, line int) error {
	text := strings.TrimSpace(stripComment(raw))
	if text == "" {
		return nil
	}

	if strings.HasPrefix(text, "[") && strings.HasSuffix(text, "]") {
		name := strings.ToLower(strings.TrimSpace(text[1 : len(text)-1]))
		switch name {
		case "interface":
			if p.seenInterface {
				return fmt.Errorf("line %d: duplicate [Interface] section", line)
			}
			p.seenInterface = true
		case "peer":
			if p.seenPeer {
				return fmt.Errorf("line %d: only one [Peer] is supported", line)
			}
			p.seenPeer = true
		default:
			return fmt.Errorf("line %d: unsupported section [%s]", line, name)
		}
		p.section = name
		return nil
	}

	key, value, ok := strings.Cut(text, "=")
	if !ok {
		return fmt.Errorf("line %d: expected key = value", line)
	}
	key = strings.ToLower(strings.TrimSpace(key))
	value = strings.TrimSpace(value)

	switch p.section {
	case "interface":
		return p.parseInterface(key, value, line)
	case "peer":
		return p.parsePeer(key, value, line)
	default:
		return fmt.Errorf("line %d: key outside a section", line)
	}
}

func (p *tunnelParser) parseInterface(key, value string, line int) error {
	switch key {
	case "privatekey":
		if p.havePrivate {
			return fmt.Errorf("line %d: duplicate PrivateKey", line)
		}
		key, err := wgtypes.ParseKey(value)
		if err != nil {
			return fmt.Errorf("line %d: invalid PrivateKey", line)
		}
		p.cfg.PrivateKey = key
		p.havePrivate = true
	case "address":
		addrs, err := parseAddresses(value)
		if err != nil {
			return fmt.Errorf("line %d: %w", line, err)
		}
		p.cfg.Addresses = append(p.cfg.Addresses, addrs...)
	case "dns":
		ips, err := parseIPs(value)
		if err != nil {
			return fmt.Errorf("line %d: %w", line, err)
		}
		p.cfg.DNS = append(p.cfg.DNS, ips...)
	case "mtu":
		n, err := strconv.Atoi(value)
		if err != nil {
			return fmt.Errorf("line %d: invalid MTU", line)
		}
		p.mtu = n
	case "listenport":
		n, err := strconv.Atoi(value)
		if err != nil || n < 0 || n > 65535 {
			return fmt.Errorf("line %d: invalid ListenPort", line)
		}
		p.cfg.ListenPort = uint16(n)
	}
	return nil
}

func (p *tunnelParser) parsePeer(key, value string, line int) error {
	switch key {
	case "publickey":
		if p.havePeerKey {
			return fmt.Errorf("line %d: duplicate PublicKey", line)
		}
		key, err := wgtypes.ParseKey(value)
		if err != nil {
			return fmt.Errorf("line %d: invalid PublicKey", line)
		}
		p.cfg.PeerPublicKey = key
		p.havePeerKey = true
	case "presharedkey":
		if value == "" {
			return nil
		}
		key, err := wgtypes.ParseKey(value)
		if err != nil {
			return fmt.Errorf("line %d: invalid PresharedKey", line)
		}
		p.cfg.PresharedKey = &key
	case "endpoint":
		if err := validateEndpoint(value); err != nil {
			return fmt.Errorf("line %d: %w", line, err)
		}
		p.cfg.Endpoint = value
		p.haveEndpoint = true
	}
	return nil
}

func (p *tunnelParser) finish() (Tunnel, error) {
	if !p.seenInterface {
		return Tunnel{}, errors.New("missing [Interface] section")
	}
	if !p.seenPeer {
		return Tunnel{}, errors.New("missing [Peer] section")
	}
	if !p.havePrivate {
		return Tunnel{}, errors.New("missing PrivateKey")
	}
	if !p.havePeerKey {
		return Tunnel{}, errors.New("missing PublicKey")
	}
	if !p.haveEndpoint {
		return Tunnel{}, errors.New("missing Endpoint")
	}
	if len(p.cfg.Addresses) == 0 {
		return Tunnel{}, errors.New("missing Address")
	}

	if p.mtu == 0 {
		p.mtu = defaultMTU
	}
	if p.mtu < minMTU || p.mtu > maxMTU {
		return Tunnel{}, fmt.Errorf("MTU must be between %d and %d", minMTU, maxMTU)
	}
	p.cfg.MTU = p.mtu

	return p.cfg, nil
}

func parseAddresses(value string) ([]net.IPNet, error) {
	var out []net.IPNet
	for _, part := range strings.Split(value, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		ip, network, err := net.ParseCIDR(part)
		if err != nil {
			return nil, errors.New("invalid Address")
		}
		out = append(out, net.IPNet{IP: ip, Mask: network.Mask})
	}
	if len(out) == 0 {
		return nil, errors.New("empty Address")
	}
	return out, nil
}

func parseIPs(value string) ([]net.IP, error) {
	var out []net.IP
	for _, part := range strings.Split(value, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		ip := net.ParseIP(part)
		if ip == nil {
			return nil, errors.New("invalid DNS address")
		}
		out = append(out, ip)
	}
	if len(out) == 0 {
		return nil, errors.New("empty DNS list")
	}
	return out, nil
}

func validateEndpoint(value string) error {
	host, port, err := net.SplitHostPort(value)
	if err != nil {
		return errors.New("invalid Endpoint")
	}
	if host == "" {
		return errors.New("Endpoint is missing a host")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return errors.New("Endpoint has an invalid port")
	}
	return nil
}

func stripComment(line string) string {
	if i := strings.IndexAny(line, "#;"); i >= 0 {
		return line[:i]
	}
	return line
}
