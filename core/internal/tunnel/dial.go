package tunnel

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"

	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/header"
)

func (d *Device) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	ip, port, proto, err := parseTarget(network, address)
	if err != nil {
		return nil, err
	}

	conn, err := gonet.DialContextTCP(ctx, d.stack, tcpip.FullAddress{
		NIC:  nicID,
		Addr: tcpipAddr(ip),
		Port: port,
	}, proto)
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func (d *Device) Listen(network, address string) (net.Listener, error) {
	ip, port, proto, err := parseTarget(network, address)
	if err != nil {
		return nil, err
	}

	listener, err := gonet.ListenTCP(d.stack, tcpip.FullAddress{
		NIC:  nicID,
		Addr: tcpipAddr(ip),
		Port: port,
	}, proto)
	if err != nil {
		return nil, err
	}
	return listener, nil
}

func parseTarget(network, address string) (net.IP, uint16, tcpip.NetworkProtocolNumber, error) {
	switch network {
	case "tcp", "tcp4", "tcp6":
	default:
		return nil, 0, 0, fmt.Errorf("unsupported network %q", network)
	}

	host, portStr, err := net.SplitHostPort(address)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("invalid address %q: %w", address, err)
	}

	ip := net.ParseIP(host)
	if ip == nil {
		return nil, 0, 0, fmt.Errorf("address %q must be an IP literal", host)
	}

	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return nil, 0, 0, fmt.Errorf("invalid port in %q", address)
	}

	var proto tcpip.NetworkProtocolNumber
	if ip.To4() != nil {
		if network == "tcp6" {
			return nil, 0, 0, errors.New("tcp6 requires an IPv6 address")
		}
		proto = header.IPv4ProtocolNumber
	} else {
		if network == "tcp4" {
			return nil, 0, 0, errors.New("tcp4 requires an IPv4 address")
		}
		proto = header.IPv6ProtocolNumber
	}

	return ip, uint16(port), proto, nil
}

func tcpipAddr(ip net.IP) tcpip.Address {
	if v4 := ip.To4(); v4 != nil {
		return tcpip.AddrFromSlice(v4)
	}
	return tcpip.AddrFromSlice(ip.To16())
}
