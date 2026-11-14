package external

import (
	"errors"
	"net"
	"testing"
)

func parseIP(t *testing.T, raw string) net.IP {
	t.Helper()
	ip := net.ParseIP(raw)
	if ip == nil {
		t.Fatalf("invalid test IP %q", raw)
	}
	return ip
}

func TestNormalizeMode(t *testing.T) {
	tests := []struct {
		name          string
		mode          string
		allowExternal bool
		want          string
		wantErr       bool
	}{
		{"off", "off", false, ModeOff, false},
		{"all", "all", true, ModeAll, false},
		{"origins", "origins", true, ModeOrigins, false},
		{"uppercase", " ALL ", true, ModeAll, false},
		{"legacy off", "", false, ModeOff, false},
		{"legacy origins", "", true, ModeOrigins, false},
		{"invalid", "everything", true, "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeMode(tt.mode, tt.allowExternal)
			if (err != nil) != tt.wantErr {
				t.Fatalf("error = %v, wantErr = %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("mode = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParse(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{"https default port", "https://fonts.googleapis.com", "https://fonts.googleapis.com"},
		{"http default port", "http://example.com/", "http://example.com"},
		{"explicit port", "https://cdn.example.com:8443", "https://cdn.example.com:8443"},
		{"uppercase scheme and host", "HTTPS://CDN.Example.COM", "https://cdn.example.com"},
		{"public IPv4", "https://1.1.1.1", "https://1.1.1.1"},
		{"public IPv6", "https://[2606:4700:4700::1111]", "https://[2606:4700:4700::1111]"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			origin, err := Parse(tt.raw)
			if err != nil {
				t.Fatal(err)
			}
			if got := origin.String(); got != tt.want {
				t.Fatalf("String() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseRejects(t *testing.T) {
	tests := []string{
		"",
		"example.com",
		"ftp://example.com",
		"https://user:pass@example.com",
		"https://example.com/path",
		"https://example.com/?q=1",
		"https://example.com/#fragment",
		"https://*.example.com",
		"https://example.com:0",
		"https://example.com:70000",
		"https://127.0.0.1",
		"https://192.168.1.10",
		"https://10.0.0.1",
		"https://100.64.0.1",
	}

	for _, raw := range tests {
		t.Run(raw, func(t *testing.T) {
			if _, err := Parse(raw); !errors.Is(err, ErrInvalidOrigin) {
				t.Fatalf("Parse(%q) error = %v, want ErrInvalidOrigin", raw, err)
			}
		})
	}
}

func TestParseAllNormalises(t *testing.T) {
	origins, err := ParseAll([]string{
		"https://fonts.googleapis.com/",
		" HTTPS://FONTS.GOOGLEAPIS.COM ",
		"http://example.com:80",
		"",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(origins) != 2 {
		t.Fatalf("len = %d, want 2", len(origins))
	}
	if origins[0].Key() != "https://fonts.googleapis.com:443" {
		t.Fatalf("first = %q", origins[0].Key())
	}
	if origins[1].Key() != "http://example.com:80" {
		t.Fatalf("second = %q", origins[1].Key())
	}
}

func TestMatch(t *testing.T) {
	origin, err := Parse("https://fonts.googleapis.com")
	if err != nil {
		t.Fatal(err)
	}

	if !origin.Match("https", "fonts.googleapis.com", "443") {
		t.Fatal("expected exact match")
	}
	if !origin.Match("HTTPS", "FONTS.GOOGLEAPIS.COM", "443") {
		t.Fatal("expected case-insensitive match")
	}
	if origin.Match("http", "fonts.googleapis.com", "443") {
		t.Fatal("scheme must match")
	}
	if origin.Match("https", "fonts.googleapis.com", "80") {
		t.Fatal("port must match")
	}
	if origin.Match("https", "cdn.example.com", "443") {
		t.Fatal("host must match")
	}
}

func TestIsPublicIP(t *testing.T) {
	tests := []struct {
		raw  string
		want bool
	}{
		{"1.1.1.1", true},
		{"8.8.8.8", true},
		{"2606:4700:4700::1111", true},
		{"127.0.0.1", false},
		{"192.168.1.10", false},
		{"10.0.0.1", false},
		{"100.64.0.1", false},
		{"169.254.1.1", false},
		{"fe80::1", false},
		{"fc00::1", false},
	}

	for _, tt := range tests {
		ip := parseIP(t, tt.raw)
		if got := IsPublicIP(ip); got != tt.want {
			t.Errorf("IsPublicIP(%s) = %v, want %v", tt.raw, got, tt.want)
		}
	}
}
