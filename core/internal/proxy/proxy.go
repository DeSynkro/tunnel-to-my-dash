package proxy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"sync"
	"time"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/external"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/lan"
)

type Dialer interface {
	DialContext(ctx context.Context, network, address string) (net.Conn, error)
}

// Route says which network a destination belongs to.
type Route int

const (
	RouteTunnel Route = iota
	RouteDirect
)

type Policy interface {
	Route(scheme, host, port string) (Route, error)
}

type Server struct {
	tunnelDialer Dialer
	directDialer Dialer
	policy       Policy

	tunnelProxy *httputil.ReverseProxy
	directProxy *httputil.ReverseProxy
	http        *http.Server
	once        sync.Once
}

func New(tunnelDialer, directDialer Dialer, policy Policy) *Server {
	s := &Server{
		tunnelDialer: tunnelDialer,
		directDialer: directDialer,
		policy:       policy,
	}
	s.tunnelProxy = s.reverseProxy(tunnelDialer)
	s.directProxy = s.reverseProxy(directDialer)
	return s
}

func (s *Server) reverseProxy(dialer Dialer) *httputil.ReverseProxy {
	transport := &http.Transport{
		Proxy:              nil,
		DialContext:        dialer.DialContext,
		DisableCompression: true,
		ForceAttemptHTTP2:  false,
	}

	return &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.Header.Del("Proxy-Connection")
			req.Header.Del("Proxy-Authorization")
			req.Host = req.URL.Host
		},
		Transport:     transport,
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}
}

func (s *Server) Start() (net.Addr, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	s.http = &http.Server{
		Handler:           s,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go s.http.Serve(listener)

	return listener.Addr(), nil
}

func (s *Server) Close() error {
	var err error
	s.once.Do(func() {
		if s.http != nil {
			err = s.http.Close()
		}
	})
	return err
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		s.handleConnect(w, r)
		return
	}

	if r.URL.Scheme != "http" {
		http.Error(w, "only plain HTTP and CONNECT are supported", http.StatusBadRequest)
		return
	}

	host := r.URL.Hostname()
	if host == "" {
		http.Error(w, "missing host", http.StatusBadRequest)
		return
	}
	port := r.URL.Port()
	if port == "" {
		port = "80"
	}

	route, err := s.policy.Route("http", host, port)
	if err != nil {
		http.Error(w, blockedMessage, http.StatusForbidden)
		return
	}

	s.proxyFor(route).ServeHTTP(w, r)
}

func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	host, port, err := net.SplitHostPort(r.Host)
	if err != nil {
		http.Error(w, "invalid CONNECT target", http.StatusBadRequest)
		return
	}

	route, err := s.policy.Route("https", host, port)
	if err != nil {
		http.Error(w, blockedMessage, http.StatusForbidden)
		return
	}

	upstream, err := s.dialerFor(route).DialContext(
		r.Context(),
		"tcp",
		net.JoinHostPort(host, port),
	)
	if err != nil {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		upstream.Close()
		http.Error(w, "connection hijacking is not supported", http.StatusInternalServerError)
		return
	}

	client, buffered, err := hijacker.Hijack()
	if err != nil {
		upstream.Close()
		return
	}
	defer client.Close()
	defer upstream.Close()

	if _, err := client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n")); err != nil {
		return
	}

	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(upstream, buffered)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(client, upstream)
		done <- struct{}{}
	}()
	<-done
}

func (s *Server) proxyFor(route Route) *httputil.ReverseProxy {
	if route == RouteDirect {
		return s.directProxy
	}
	return s.tunnelProxy
}

func (s *Server) dialerFor(route Route) Dialer {
	if route == RouteDirect {
		return s.directDialer
	}
	return s.tunnelDialer
}

const blockedMessage = "This app blocks destinations outside the LAN and the profile's allowed external origins."

// LANPolicy keeps the original strict behaviour: private addresses only.
type LANPolicy struct{}

func (LANPolicy) Route(_ string, host, port string) (Route, error) {
	ip := net.ParseIP(host)
	if ip == nil {
		return RouteTunnel, errors.New("hostnames are not supported yet")
	}
	if !lan.IsLAN(ip) {
		return RouteTunnel, errors.New("destination is not on the LAN")
	}
	return RouteTunnel, nil
}

// ExternalPolicy routes private addresses through the tunnel and exact,
// configured public origins directly. Everything else is refused.
type ExternalPolicy struct {
	Allow   bool
	Origins []external.Origin
}

func (p ExternalPolicy) Route(scheme, host, port string) (Route, error) {
	if ip := net.ParseIP(host); ip != nil && lan.IsLAN(ip) {
		return RouteTunnel, nil
	}
	if !p.Allow {
		return RouteDirect, errors.New("external content is off")
	}
	for _, origin := range p.Origins {
		if origin.Match(scheme, host, port) {
			return RouteDirect, nil
		}
	}
	return RouteDirect, errors.New("destination is not an allowed external origin")
}

// DirectDialer resolves external names itself and only connects to public
// addresses, so an allowed origin cannot be pointed at the local machine or
// the LAN by DNS.
type DirectDialer struct {
	Resolver *net.Resolver
	Dialer   net.Dialer
}

func (d DirectDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}

	dialer := d.Dialer
	if dialer.Timeout == 0 {
		dialer.Timeout = 10 * time.Second
	}
	if dialer.KeepAlive == 0 {
		dialer.KeepAlive = 30 * time.Second
	}

	if ip := net.ParseIP(host); ip != nil {
		if !external.IsPublicIP(ip) {
			return nil, errors.New("external destination is not public")
		}
		return dialer.DialContext(ctx, network, address)
	}

	resolver := d.Resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	addresses, err := resolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}

	var lastErr error
	for _, candidate := range addresses {
		if !external.IsPublicIP(candidate.IP) {
			continue
		}
		conn, err := dialer.DialContext(
			ctx,
			network,
			net.JoinHostPort(candidate.IP.String(), port),
		)
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("external destination %s has no public address", host)
}
