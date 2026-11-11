package tunnel

import (
	"context"
	"fmt"
	"net"
	"os"
	"sync"

	"golang.zx2c4.com/wireguard/tun"
	"gvisor.dev/gvisor/pkg/buffer"
	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/header"
	"gvisor.dev/gvisor/pkg/tcpip/link/channel"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv6"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
	"gvisor.dev/gvisor/pkg/tcpip/transport/tcp"
	"gvisor.dev/gvisor/pkg/tcpip/transport/udp"
)

const nicID = 1

type netTUN struct {
	link      *channel.Endpoint
	ctx       context.Context
	cancel    context.CancelFunc
	mtu       uint32
	events    chan tun.Event
	closeOnce sync.Once
}

func newNetTUN(link *channel.Endpoint, mtu uint32) *netTUN {
	ctx, cancel := context.WithCancel(context.Background())
	t := &netTUN{
		link:   link,
		ctx:    ctx,
		cancel: cancel,
		mtu:    mtu,
		events: make(chan tun.Event, 1),
	}
	t.events <- tun.EventUp
	return t
}

func (t *netTUN) File() *os.File { return nil }

func (t *netTUN) Read(bufs [][]byte, sizes []int, offset int) (int, error) {
	if len(bufs) == 0 || len(sizes) == 0 {
		return 0, nil
	}

	pkt := t.link.ReadContext(t.ctx)
	if pkt == nil {
		return 0, net.ErrClosed
	}
	defer pkt.DecRef()

	n := 0
	dst := bufs[0][offset:]
	for _, part := range pkt.AsSlices() {
		if n == len(dst) {
			break
		}
		n += copy(dst[n:], part)
	}
	sizes[0] = n
	return 1, nil
}

func (t *netTUN) Write(bufs [][]byte, offset int) (int, error) {
	for _, buf := range bufs {
		data := buf[offset:]
		if len(data) == 0 {
			continue
		}

		var proto tcpip.NetworkProtocolNumber
		switch data[0] >> 4 {
		case 4:
			proto = header.IPv4ProtocolNumber
		case 6:
			proto = header.IPv6ProtocolNumber
		default:
			continue
		}

		pkt := stack.NewPacketBuffer(stack.PacketBufferOptions{
			Payload: buffer.MakeWithData(append([]byte(nil), data...)),
		})
		t.link.InjectInbound(proto, pkt)
		pkt.DecRef()
	}
	return len(bufs), nil
}

func (t *netTUN) MTU() (int, error)        { return int(t.mtu), nil }
func (t *netTUN) Name() (string, error)    { return "ttmd", nil }
func (t *netTUN) Events() <-chan tun.Event { return t.events }
func (t *netTUN) BatchSize() int           { return 1 }

func (t *netTUN) Close() error {
	t.closeOnce.Do(func() {
		t.cancel()
		t.link.Close()
		close(t.events)
	})
	return nil
}

func newNetstack(mtu int, addrs []net.IPNet) (*stack.Stack, *channel.Endpoint, error) {
	s := stack.New(stack.Options{
		NetworkProtocols:   []stack.NetworkProtocolFactory{ipv4.NewProtocol, ipv6.NewProtocol},
		TransportProtocols: []stack.TransportProtocolFactory{tcp.NewProtocol, udp.NewProtocol},
	})
	link := channel.New(256, uint32(mtu), "")

	fail := func(format string, args ...any) (*stack.Stack, *channel.Endpoint, error) {
		link.Close()
		s.Close()
		return nil, nil, fmt.Errorf(format, args...)
	}

	if err := s.CreateNIC(nicID, link); err != nil {
		return fail("create nic: %v", err)
	}
	if err := s.SetPromiscuousMode(nicID, true); err != nil {
		return fail("set promiscuous mode: %v", err)
	}
	if err := s.SetSpoofing(nicID, true); err != nil {
		return fail("set spoofing: %v", err)
	}

	for _, addr := range addrs {
		ip := addr.IP.To4()
		proto := tcpip.NetworkProtocolNumber(header.IPv4ProtocolNumber)
		if ip == nil {
			ip = addr.IP.To16()
			proto = header.IPv6ProtocolNumber
		}
		if ip == nil {
			return fail("invalid address %s", addr.String())
		}

		ones, bits := addr.Mask.Size()
		if ones < 0 || (bits != 32 && bits != 128) {
			return fail("invalid prefix in %s", addr.String())
		}

		err := s.AddProtocolAddress(nicID, tcpip.ProtocolAddress{
			Protocol: proto,
			AddressWithPrefix: tcpip.AddressWithPrefix{
				Address:   tcpip.AddrFromSlice(ip),
				PrefixLen: ones,
			},
		}, stack.AddressProperties{})
		if err != nil {
			return fail("add address %s: %v", addr.String(), err)
		}
	}

	s.SetRouteTable([]tcpip.Route{
		{Destination: header.IPv4EmptySubnet, NIC: nicID},
		{Destination: header.IPv6EmptySubnet, NIC: nicID},
	})

	return s, link, nil
}
