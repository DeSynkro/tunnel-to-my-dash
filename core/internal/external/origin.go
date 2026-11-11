// Package external validates the public origins a profile may load outside
// the LAN. External content is opt-in and always exact-origin scoped.
package external

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

var ErrInvalidOrigin = errors.New("invalid external origin")

// Origin is a canonical http or https origin: scheme, host and port.
type Origin struct {
	Scheme string
	Host   string
	Port   string
}

// Parse validates and canonicalises one origin. Paths, queries, fragments,
// credentials and wildcards are rejected so the rule cannot be widened by
// accident.
func Parse(raw string) (Origin, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Origin{}, fmt.Errorf("%w: empty", ErrInvalidOrigin)
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return Origin{}, fmt.Errorf("%w: %v", ErrInvalidOrigin, err)
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return Origin{}, fmt.Errorf("%w: scheme must be http or https", ErrInvalidOrigin)
	}
	if parsed.User != nil {
		return Origin{}, fmt.Errorf("%w: credentials are not allowed", ErrInvalidOrigin)
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return Origin{}, fmt.Errorf("%w: paths are not allowed", ErrInvalidOrigin)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || parsed.ForceQuery {
		return Origin{}, fmt.Errorf("%w: queries and fragments are not allowed", ErrInvalidOrigin)
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return Origin{}, fmt.Errorf("%w: host is required", ErrInvalidOrigin)
	}
	if strings.Contains(host, "*") {
		return Origin{}, fmt.Errorf("%w: wildcards are not allowed", ErrInvalidOrigin)
	}
	if ip := net.ParseIP(host); ip != nil {
		if !IsPublicIP(ip) {
			return Origin{}, fmt.Errorf("%w: IP address is not public", ErrInvalidOrigin)
		}
	} else if !validHostname(host) {
		return Origin{}, fmt.Errorf("%w: host is not a valid hostname", ErrInvalidOrigin)
	}

	port := parsed.Port()
	if port == "" {
		if scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return Origin{}, fmt.Errorf("%w: invalid port", ErrInvalidOrigin)
	}

	return Origin{Scheme: scheme, Host: host, Port: port}, nil
}

// ParseAll validates a list, removes duplicates and preserves order.
func ParseAll(raws []string) ([]Origin, error) {
	origins := make([]Origin, 0, len(raws))
	seen := make(map[string]struct{}, len(raws))

	for _, raw := range raws {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		origin, err := Parse(raw)
		if err != nil {
			return nil, err
		}
		key := origin.Key()
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		origins = append(origins, origin)
	}

	return origins, nil
}

// Strings returns canonical, display-friendly origin strings.
func Strings(origins []Origin) []string {
	out := make([]string, len(origins))
	for i, origin := range origins {
		out[i] = origin.String()
	}
	return out
}

// String omits the default port for readability.
func (o Origin) String() string {
	if (o.Scheme == "https" && o.Port == "443") || (o.Scheme == "http" && o.Port == "80") {
		return o.Scheme + "://" + o.hostString()
	}
	return o.Scheme + "://" + o.hostString() + ":" + o.Port
}

// Key is the exact matching key, including the port.
func (o Origin) Key() string {
	return o.Scheme + "://" + o.hostString() + ":" + o.Port
}

func (o Origin) hostString() string {
	if strings.Contains(o.Host, ":") {
		return "[" + o.Host + "]"
	}
	return o.Host
}

// Match reports whether a request target is exactly this origin.
func (o Origin) Match(scheme, host, port string) bool {
	return o.Scheme == strings.ToLower(scheme) &&
		o.Host == strings.ToLower(host) &&
		o.Port == port
}

// IsPublicIP reports whether an address is safe to reach directly as external
// content. Loopback, private, link-local, multicast and CGNAT ranges are out.
func IsPublicIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return false
		}
	}
	return true
}

func validHostname(host string) bool {
	if len(host) > 253 {
		return false
	}
	labels := strings.Split(host, ".")
	for _, label := range labels {
		if label == "" || len(label) > 63 {
			return false
		}
		for i := 0; i < len(label); i++ {
			c := label[i]
			if c >= 'a' && c <= 'z' || c >= '0' && c <= '9' {
				continue
			}
			if c == '-' && i > 0 && i < len(label)-1 {
				continue
			}
			return false
		}
	}
	return true
}
