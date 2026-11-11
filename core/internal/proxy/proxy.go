package proxy

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"sync"
	"time"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/lan"
)

type Dialer interface {
	DialContext(ctx context.Context, network, address string) (net.Conn, error)
}

type Policy interface {
	Allow(host, port string) error
}

type Server struct {
	dialer Dialer
	policy Policy
	proxy  *httputil.ReverseProxy
	http   *http.Server
	once   sync.Once
}

func New(dialer Dialer, policy Policy) *Server {
	s := &Server{
		dialer: dialer,
		policy: policy,
	}

	transport := &http.Transport{
		Proxy:              nil,
		DialContext:        s.dialer.DialContext,
		DisableCompression: true,
		ForceAttemptHTTP2:  false,
	}

	s.proxy = &httputil.ReverseProxy{
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

	return s
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
	if err := s.policy.Allow(host, port); err != nil {
		http.Error(w, "This app can only reach private LAN addresses.", http.StatusForbidden)
		return
	}

	s.proxy.ServeHTTP(w, r)
}

func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	host, port, err := net.SplitHostPort(r.Host)
	if err != nil {
		http.Error(w, "invalid CONNECT target", http.StatusBadRequest)
		return
	}
	if err := s.policy.Allow(host, port); err != nil {
		http.Error(w, "This app can only reach private LAN addresses.", http.StatusForbidden)
		return
	}

	upstream, err := s.dialer.DialContext(r.Context(), "tcp", net.JoinHostPort(host, port))
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

type LANPolicy struct{}

func (LANPolicy) Allow(host, port string) error {
	ip := net.ParseIP(host)
	if ip == nil {
		return errors.New("hostnames are not supported yet")
	}
	if !lan.IsLAN(ip) {
		return errors.New("destination is not on the LAN")
	}
	return nil
}
