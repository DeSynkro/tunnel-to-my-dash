package lan

import "net"

var (
	range10  = mustCIDR("10.0.0.0/8")
	range172 = mustCIDR("172.16.0.0/12")
	range192 = mustCIDR("192.168.0.0/16")
	rangeULA = mustCIDR("fc00::/7")
)

var defaultAllowedIPs = []net.IPNet{
	*range10,
	*range172,
	*range192,
	*rangeULA,
}

// IsLAN reports whether ip belongs to a private IPv4 range or an IPv6 unique
// local address. Loopback, link-local, multicast and unspecified addresses are
// not considered LAN destinations.
func IsLAN(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() {
		return false
	}
	return range10.Contains(ip) || range172.Contains(ip) || range192.Contains(ip) || rangeULA.Contains(ip)
}

// IsLoopback reports whether ip is a loopback address.
func IsLoopback(ip net.IP) bool {
	return ip != nil && ip.IsLoopback()
}

// DefaultAllowedIPs returns the ranges the userspace tunnel is allowed to
// carry. The caller gets a copy, so modifying it does not affect the defaults.
func DefaultAllowedIPs() []net.IPNet {
	out := make([]net.IPNet, len(defaultAllowedIPs))
	copy(out, defaultAllowedIPs)
	return out
}

func mustCIDR(s string) *net.IPNet {
	_, network, err := net.ParseCIDR(s)
	if err != nil {
		panic("lan: invalid CIDR " + s)
	}
	return network
}
