package nav

import (
	"net"
	"net/url"
	"strings"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/external"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/lan"
)

// Kind classifies where a top-level HTTP link should be handled.
type Kind int

const (
	// Blocked links must not be opened: non-HTTP schemes, credentials,
	// loopback, link-local, CGNAT and other unsafe targets.
	Blocked Kind = iota
	// Private links belong on the LAN and stay in the tunneled WebView.
	Private
	// Public links are ordinary internet destinations. They never use the
	// tunnel; the app either blocks them or hands them to the system browser.
	Public
)

func (k Kind) String() string {
	switch k {
	case Private:
		return "private"
	case Public:
		return "public"
	default:
		return "blocked"
	}
}

// Classify inspects a top-level navigation target. It intentionally does not
// resolve DNS: the decision is based on the URL's host form, so the WebView
// never waits on a lookup before deciding.
func Classify(raw string) Kind {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || parsed.User != nil {
		return Blocked
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return Blocked
	}

	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if host == "" {
		return Blocked
	}

	if ip := net.ParseIP(host); ip != nil {
		if lan.IsLAN(ip) {
			return Private
		}
		if external.IsPublicIP(ip) {
			return Public
		}
		return Blocked
	}

	// Browsers accept non-canonical numeric IPv4 forms such as 127.1,
	// 2130706433 and 0x7f000001. Classifying those as private would let them
	// keep the tunnel and bypass the public-link switch, so block them.
	if isNumericHost(host) {
		return Blocked
	}

	if host == "localhost" {
		return Blocked
	}
	if !strings.Contains(host, ".") {
		return Private
	}
	for _, suffix := range []string{".local", ".internal", ".lan", ".home.arpa"} {
		if strings.HasSuffix(host, suffix) {
			return Private
		}
	}
	return Public
}

func isNumericHost(host string) bool {
	if strings.HasPrefix(host, "0x") {
		return true
	}
	for _, r := range host {
		if r != '.' && (r < '0' || r > '9') {
			return false
		}
	}
	return host != ""
}
