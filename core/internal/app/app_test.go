package app

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/tunnel"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

func TestEndToEnd(t *testing.T) {
	portA := freeUDPPort(t)
	portB := freeUDPPort(t)
	for portB == portA {
		portB = freeUDPPort(t)
	}

	aKey, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	bKey, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	psk, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}

	server, err := tunnel.Start(tunnel.Config{
		PrivateKey:    aKey,
		PeerPublicKey: bKey.PublicKey(),
		PresharedKey:  &psk,
		Endpoint:      endpoint(portB),
		Addresses:     []net.IPNet{mustIPNet(t, "10.66.0.1/24")},
		MTU:           1420,
		ListenPort:    portA,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	listener, err := server.Listen("tcp", "10.66.0.1:8081")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	go func() {
		_ = http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprint(w, "through")
		}))
	}()

	instance, err := Start(config.Tunnel{
		PrivateKey:    bKey,
		PeerPublicKey: aKey.PublicKey(),
		PresharedKey:  &psk,
		Endpoint:      endpoint(portA),
		Addresses:     []net.IPNet{mustIPNet(t, "10.66.0.2/24")},
		MTU:           1420,
		ListenPort:    portB,
	}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer instance.Close()

	proxyURL := &url.URL{Scheme: "http", Host: instance.ProxyAddr().String()}
	client := &http.Client{
		Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)},
		Timeout:   10 * time.Second,
	}

	resp, err := client.Get("http://10.66.0.1:8081/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if string(body) != "through" {
		t.Fatalf("body = %q, want %q", body, "through")
	}
}

func TestStartRejectsBadConfig(t *testing.T) {
	if _, err := Start(config.Tunnel{}, Options{}); err == nil {
		t.Fatal("expected an error")
	}
}

func freeUDPPort(t *testing.T) uint16 {
	t.Helper()
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	return uint16(conn.LocalAddr().(*net.UDPAddr).Port)
}

func mustIPNet(t *testing.T, s string) net.IPNet {
	t.Helper()
	ip, network, err := net.ParseCIDR(s)
	if err != nil {
		t.Fatal(err)
	}
	return net.IPNet{IP: ip, Mask: network.Mask}
}

func endpoint(port uint16) string {
	return fmt.Sprintf("127.0.0.1:%d", port)
}
