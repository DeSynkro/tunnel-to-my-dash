package nav

import "testing"

func TestClassify(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want Kind
	}{
		{name: "private lan ipv4", raw: "http://192.168.0.3:3000/", want: Private},
		{name: "private ten range", raw: "https://10.0.0.5/", want: Private},
		{name: "private 172 range", raw: "http://172.20.1.1/", want: Private},
		{name: "private ula", raw: "http://[fd00::1]/", want: Private},
		{name: "private local suffix", raw: "http://homeassistant.local/", want: Private},
		{name: "private bare hostname", raw: "http://printer/", want: Private},
		{name: "public hostname", raw: "https://example.com/", want: Public},
		{name: "public hostname with port", raw: "http://example.com:8080/path", want: Public},
		{name: "public ipv4", raw: "https://8.8.8.8/", want: Public},
		{name: "public ipv6", raw: "https://[2001:4860:4860::8888]/", want: Public},
		{name: "file scheme", raw: "file:///etc/passwd", want: Blocked},
		{name: "javascript scheme", raw: "javascript:alert(1)", want: Blocked},
		{name: "userinfo", raw: "https://user:pass@example.com/", want: Blocked},
		{name: "not a url", raw: "not a url", want: Blocked},
		{name: "localhost", raw: "http://localhost/", want: Blocked},
		{name: "loopback ipv4", raw: "http://127.0.0.1/", want: Blocked},
		{name: "link local", raw: "http://169.254.1.1/", want: Blocked},
		{name: "decimal ipv4", raw: "http://2130706433/", want: Blocked},
		{name: "hex ipv4", raw: "http://0x7f000001/", want: Blocked},
		{name: "short ipv4", raw: "http://127.1/", want: Blocked},
		{name: "public decimal ipv4", raw: "http://134744072/", want: Blocked},
		{name: "cgnat", raw: "http://100.64.0.1/", want: Blocked},
		{name: "loopback ipv6", raw: "http://[::1]/", want: Blocked},
		{name: "link local ipv6", raw: "http://[fe80::1]/", want: Blocked},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Classify(tt.raw); got != tt.want {
				t.Fatalf("Classify(%q) = %v, want %v", tt.raw, got, tt.want)
			}
		})
	}
}

func TestKindString(t *testing.T) {
	tests := []struct {
		kind Kind
		want string
	}{
		{kind: Blocked, want: "blocked"},
		{kind: Private, want: "private"},
		{kind: Public, want: "public"},
	}
	for _, tt := range tests {
		if got := tt.kind.String(); got != tt.want {
			t.Fatalf("Kind(%d).String() = %q, want %q", tt.kind, got, tt.want)
		}
	}
}
