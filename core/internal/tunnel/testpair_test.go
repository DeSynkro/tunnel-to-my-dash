package tunnel

import (
	"fmt"
	"net"
	"testing"

	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

type testPair struct {
	a *Device
	b *Device
}

func startPair(t *testing.T) *testPair {
	t.Helper()

	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		portA := freeUDPPort(t)
		portB := freeUDPPort(t)
		if portA == portB {
			continue
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

		a, err := Start(Config{
			PrivateKey:    aKey,
			PeerPublicKey: bKey.PublicKey(),
			PresharedKey:  &psk,
			Endpoint:      endpoint(portB),
			Addresses:     []net.IPNet{mustIPNet(t, "10.66.0.1/24")},
			MTU:           1420,
			ListenPort:    portA,
		})
		if err != nil {
			lastErr = err
			continue
		}

		b, err := Start(Config{
			PrivateKey:    bKey,
			PeerPublicKey: aKey.PublicKey(),
			PresharedKey:  &psk,
			Endpoint:      endpoint(portA),
			Addresses:     []net.IPNet{mustIPNet(t, "10.66.0.2/24")},
			MTU:           1420,
			ListenPort:    portB,
		})
		if err != nil {
			a.Close()
			lastErr = err
			continue
		}

		pair := &testPair{a: a, b: b}
		t.Cleanup(func() {
			a.Close()
			b.Close()
		})
		return pair
	}

	t.Fatalf("could not start a tunnel pair: %v", lastErr)
	return nil
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
