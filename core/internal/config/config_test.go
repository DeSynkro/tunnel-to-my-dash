package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

func testKey(t *testing.T) wgtypes.Key {
	t.Helper()
	key, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func writeFile(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func validTunnel(t *testing.T) (string, wgtypes.Key, wgtypes.Key) {
	t.Helper()
	private := testKey(t)
	peer := testKey(t).PublicKey()
	psk := testKey(t)

	return fmt.Sprintf(`[Interface]
PrivateKey = %s
Address = 10.66.0.2/24, fd00::2/64
DNS = 192.168.0.1
MTU = 1380
ListenPort = 51820

[Peer]
PublicKey = %s
PresharedKey = %s
Endpoint = 203.0.113.10:51820
AllowedIPs = 0.0.0.0/0, ::/0
`, private, peer, psk), private, peer
}

func TestLoadTunnel(t *testing.T) {
	content, private, peer := validTunnel(t)
	path := writeFile(t, "wg0.conf", content)

	got, err := LoadTunnel(path)
	if err != nil {
		t.Fatal(err)
	}

	if got.PrivateKey != private {
		t.Error("private key did not round-trip")
	}
	if got.PeerPublicKey != peer {
		t.Error("peer public key did not round-trip")
	}
	if got.PresharedKey == nil {
		t.Fatal("preshared key is nil")
	}
	if got.Endpoint != "203.0.113.10:51820" {
		t.Errorf("endpoint = %q", got.Endpoint)
	}
	if got.MTU != 1380 {
		t.Errorf("MTU = %d, want 1380", got.MTU)
	}
	if got.ListenPort != 51820 {
		t.Errorf("ListenPort = %d, want 51820", got.ListenPort)
	}
	if len(got.Addresses) != 2 || got.Addresses[0].String() != "10.66.0.2/24" || got.Addresses[1].String() != "fd00::2/64" {
		t.Errorf("addresses = %v", got.Addresses)
	}
	if len(got.DNS) != 1 || got.DNS[0].String() != "192.168.0.1" {
		t.Errorf("DNS = %v", got.DNS)
	}
}

func TestLoadTunnelDefaultsMTU(t *testing.T) {
	content, _, _ := validTunnel(t)
	content = strings.Replace(content, "MTU = 1380\n", "", 1)
	path := writeFile(t, "wg0.conf", content)

	got, err := LoadTunnel(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.MTU != 1420 {
		t.Errorf("MTU = %d, want 1420", got.MTU)
	}
}

func TestLoadTunnelErrors(t *testing.T) {
	content, private, peer := validTunnel(t)

	tests := []struct {
		name   string
		mutate func(string) string
	}{
		{"missing private key", func(s string) string {
			return strings.Replace(s, "PrivateKey = "+private.String()+"\n", "", 1)
		}},
		{"invalid private key", func(s string) string {
			return strings.Replace(s, "PrivateKey = "+private.String(), "PrivateKey = nope", 1)
		}},
		{"missing peer public key", func(s string) string {
			return strings.Replace(s, "PublicKey = "+peer.String()+"\n", "", 1)
		}},
		{"missing endpoint", func(s string) string {
			return strings.Replace(s, "Endpoint = 203.0.113.10:51820\n", "", 1)
		}},
		{"invalid endpoint", func(s string) string {
			return strings.Replace(s, "Endpoint = 203.0.113.10:51820", "Endpoint = nope", 1)
		}},
		{"missing address", func(s string) string {
			return strings.Replace(s, "Address = 10.66.0.2/24, fd00::2/64\n", "", 1)
		}},
		{"invalid address", func(s string) string {
			return strings.Replace(s, "Address = 10.66.0.2/24, fd00::2/64", "Address = nope", 1)
		}},
		{"invalid MTU", func(s string) string {
			return strings.Replace(s, "MTU = 1380", "MTU = 10", 1)
		}},
		{"two peers", func(s string) string {
			return s + "\n[Peer]\nPublicKey = " + testKey(t).PublicKey().String() + "\nEndpoint = 203.0.113.11:51820\n"
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := writeFile(t, "wg0.conf", tt.mutate(content))
			_, err := LoadTunnel(path)
			if err == nil {
				t.Fatal("expected an error")
			}
			if strings.Contains(err.Error(), private.String()) {
				t.Fatal("error contains the private key")
			}
		})
	}
}

func TestLoadTunnelMissingFile(t *testing.T) {
	_, err := LoadTunnel(filepath.Join(t.TempDir(), "missing.conf"))
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestLoadApp(t *testing.T) {
	path := writeFile(t, "config.json", `{"dashboard_url":"http://192.168.0.3:3000","allow_external":true}`)

	got, err := LoadApp(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.DashboardURL != "http://192.168.0.3:3000" {
		t.Errorf("dashboard URL = %q", got.DashboardURL)
	}
	if !got.AllowExternal {
		t.Error("allow_external = false, want true")
	}
}

func TestAppValidate(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{"private http", "http://192.168.0.3:3000", true},
		{"private https", "https://192.168.0.4:3000/app", true},
		{"private ipv6", "http://[fd00::1]:3000", true},
		{"public ip", "http://8.8.8.8:3000", false},
		{"hostname", "http://dashboard.local:3000", false},
		{"bad scheme", "ftp://192.168.0.3:3000", false},
		{"userinfo", "http://user:pass@192.168.0.3:3000", false},
		{"bad port", "http://192.168.0.3:99999", false},
		{"empty", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := (App{DashboardURL: tt.url}).Validate()
			if (err == nil) != tt.want {
				t.Fatalf("Validate(%q) error = %v, want valid = %v", tt.url, err, tt.want)
			}
		})
	}
}

func TestLoadAppInvalidJSON(t *testing.T) {
	path := writeFile(t, "config.json", `{`)
	if _, err := LoadApp(path); err == nil {
		t.Fatal("expected an error")
	}
}

func TestLoadAppMissingFile(t *testing.T) {
	if _, err := LoadApp(filepath.Join(t.TempDir(), "missing.json")); err == nil {
		t.Fatal("expected an error")
	}
}
