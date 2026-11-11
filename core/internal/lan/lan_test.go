package lan

import (
	"net"
	"testing"
)

func TestIsLAN(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{"192.168.0.3", true},
		{"10.1.2.3", true},
		{"172.16.0.1", true},
		{"172.31.255.254", true},
		{"::ffff:192.168.1.1", true},
		{"fd00::1", true},
		{"172.32.0.1", false},
		{"127.0.0.1", false},
		{"169.254.1.1", false},
		{"8.8.8.8", false},
		{"::1", false},
		{"fe80::1", false},
		{"224.0.0.1", false},
		{"0.0.0.0", false},
	}

	for _, tt := range tests {
		ip := net.ParseIP(tt.addr)
		if ip == nil {
			t.Fatalf("bad test address %q", tt.addr)
		}
		if got := IsLAN(ip); got != tt.want {
			t.Errorf("IsLAN(%s) = %v, want %v", tt.addr, got, tt.want)
		}
	}

	if IsLAN(nil) {
		t.Error("IsLAN(nil) = true, want false")
	}
}

func TestIsLoopback(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{"127.0.0.1", true},
		{"127.255.255.254", true},
		{"::1", true},
		{"192.168.0.1", false},
		{"8.8.8.8", false},
	}

	for _, tt := range tests {
		ip := net.ParseIP(tt.addr)
		if got := IsLoopback(ip); got != tt.want {
			t.Errorf("IsLoopback(%s) = %v, want %v", tt.addr, got, tt.want)
		}
	}

	if IsLoopback(nil) {
		t.Error("IsLoopback(nil) = true, want false")
	}
}

func TestDefaultAllowedIPs(t *testing.T) {
	ranges := DefaultAllowedIPs()
	if len(ranges) != 4 {
		t.Fatalf("len(DefaultAllowedIPs()) = %d, want 4", len(ranges))
	}

	for _, addr := range []string{"192.168.0.3", "10.1.2.3", "172.16.0.1", "fd00::1"} {
		ip := net.ParseIP(addr)
		if !contains(ranges, ip) {
			t.Errorf("%s is not in the default ranges", addr)
		}
	}

	if contains(ranges, net.ParseIP("8.8.8.8")) {
		t.Error("8.8.8.8 is in the default ranges")
	}
}

func contains(ranges []net.IPNet, ip net.IP) bool {
	for _, r := range ranges {
		if r.Contains(ip) {
			return true
		}
	}
	return false
}
