package proxy

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/external"
)

type dialFunc func(ctx context.Context, network, address string) (net.Conn, error)

func (f dialFunc) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return f(ctx, network, address)
}

type allowAll struct{}

func (allowAll) Route(string, string, string) (Route, error) { return RouteTunnel, nil }

type denyAll struct{}

func (denyAll) Route(string, string, string) (Route, error) {
	return RouteTunnel, errors.New("blocked")
}

type routeFunc func(scheme, host, port string) (Route, error)

func (f routeFunc) Route(scheme, host, port string) (Route, error) {
	return f(scheme, host, port)
}

func startProxy(t *testing.T, tunnel, direct Dialer, policy Policy) *url.URL {
	t.Helper()
	s := New(tunnel, direct, policy)
	addr, err := s.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return &url.URL{Scheme: "http", Host: addr.String()}
}

func proxyClient(proxyURL *url.URL) *http.Client {
	return &http.Client{
		Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)},
	}
}

func TestHTTP(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "through")
	}))
	defer upstream.Close()

	dialer := dialFunc(func(ctx context.Context, network, address string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, upstream.Listener.Addr().String())
	})
	proxyURL := startProxy(t, dialer, dialer, allowAll{})

	resp, err := proxyClient(proxyURL).Get("http://upstream.test/path")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if string(body) != "through" {
		t.Fatalf("body = %q, want %q", body, "through")
	}
}

func TestBlocked(t *testing.T) {
	var called atomic.Bool
	dialer := dialFunc(func(ctx context.Context, network, address string) (net.Conn, error) {
		called.Store(true)
		return nil, errors.New("should not be called")
	})
	proxyURL := startProxy(t, dialer, dialer, denyAll{})

	resp, err := proxyClient(proxyURL).Get("http://blocked.test/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", resp.StatusCode)
	}
	if called.Load() {
		t.Fatal("dialer was called for a blocked destination")
	}
}

func TestConnect(t *testing.T) {
	upstream, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Close()

	go func() {
		for {
			conn, err := upstream.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				io.Copy(conn, conn)
			}()
		}
	}()

	dialer := dialFunc(func(ctx context.Context, network, address string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, upstream.Addr().String())
	})
	proxyURL := startProxy(t, dialer, dialer, allowAll{})

	conn, err := net.Dial("tcp", proxyURL.Host)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := fmt.Fprintf(conn, "CONNECT echo.test:443 HTTP/1.1\r\nHost: echo.test:443\r\n\r\n"); err != nil {
		t.Fatal(err)
	}

	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, &http.Request{Method: http.MethodConnect})
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("CONNECT status = %d, want 200", resp.StatusCode)
	}

	if _, err := io.WriteString(conn, "ping"); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 4)
	if _, err := io.ReadFull(reader, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != "ping" {
		t.Fatalf("echo = %q, want %q", buf, "ping")
	}
}

func TestWebSocket(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close(websocket.StatusNormalClosure, "")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		typ, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		_ = conn.Write(ctx, typ, data)
	}))
	defer upstream.Close()

	dialer := dialFunc(func(ctx context.Context, network, address string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, upstream.Listener.Addr().String())
	})
	proxyURL := startProxy(t, dialer, dialer, allowAll{})

	client := &http.Client{
		Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, resp, err := websocket.Dial(ctx, "ws://upstream.test/ws", &websocket.DialOptions{
		HTTPClient: client,
	})
	if err != nil {
		if resp != nil {
			t.Fatalf("websocket dial: %v (status %d)", err, resp.StatusCode)
		}
		t.Fatal(err)
	}
	defer conn.CloseNow()

	if err := conn.Write(ctx, websocket.MessageText, []byte("hello")); err != nil {
		t.Fatal(err)
	}
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" {
		t.Fatalf("echo = %q, want %q", data, "hello")
	}
}

func TestProxyHeadersRemoved(t *testing.T) {
	headers := make(chan http.Header, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers <- r.Header.Clone()
		fmt.Fprint(w, "ok")
	}))
	defer upstream.Close()

	dialer := dialFunc(func(ctx context.Context, network, address string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, upstream.Listener.Addr().String())
	})
	proxyURL := startProxy(t, dialer, dialer, allowAll{})

	req, err := http.NewRequest(http.MethodGet, "http://upstream.test/", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Proxy-Authorization", "Basic abc")
	req.Header.Set("Proxy-Connection", "keep-alive")

	resp, err := proxyClient(proxyURL).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	got := <-headers
	if got.Get("Proxy-Authorization") != "" {
		t.Error("Proxy-Authorization reached the upstream")
	}
	if got.Get("Proxy-Connection") != "" {
		t.Error("Proxy-Connection reached the upstream")
	}
}

func TestExternalRouteUsesDirectDialer(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "direct")
	}))
	defer upstream.Close()

	var tunnelCalled atomic.Bool
	tunnel := dialFunc(func(ctx context.Context, network, address string) (net.Conn, error) {
		tunnelCalled.Store(true)
		return nil, errors.New("tunnel should not be used")
	})
	direct := dialFunc(func(ctx context.Context, network, address string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, upstream.Listener.Addr().String())
	})
	policy := routeFunc(func(scheme, host, port string) (Route, error) {
		if scheme == "http" && host == "external.test" && port == "80" {
			return RouteDirect, nil
		}
		return RouteTunnel, errors.New("blocked")
	})

	proxyURL := startProxy(t, tunnel, direct, policy)
	resp, err := proxyClient(proxyURL).Get("http://external.test/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK || string(body) != "direct" {
		t.Fatalf("status = %d body = %q", resp.StatusCode, body)
	}
	if tunnelCalled.Load() {
		t.Fatal("external request went through the tunnel dialer")
	}
}

func TestExternalCONNECTUsesDirectDialer(t *testing.T) {
	upstream, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer upstream.Close()

	go func() {
		for {
			conn, err := upstream.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				io.Copy(conn, conn)
			}()
		}
	}()

	var tunnelCalled atomic.Bool
	tunnel := dialFunc(func(ctx context.Context, network, address string) (net.Conn, error) {
		tunnelCalled.Store(true)
		return nil, errors.New("tunnel should not be used")
	})
	direct := dialFunc(func(ctx context.Context, network, address string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, upstream.Addr().String())
	})
	policy := routeFunc(func(scheme, host, port string) (Route, error) {
		if scheme == "https" && host == "external.test" && port == "443" {
			return RouteDirect, nil
		}
		return RouteTunnel, errors.New("blocked")
	})

	proxyURL := startProxy(t, tunnel, direct, policy)
	conn, err := net.Dial("tcp", proxyURL.Host)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := fmt.Fprintf(conn, "CONNECT external.test:443 HTTP/1.1\r\nHost: external.test:443\r\n\r\n"); err != nil {
		t.Fatal(err)
	}

	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, &http.Request{Method: http.MethodConnect})
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("CONNECT status = %d, want 200", resp.StatusCode)
	}
	if _, err := io.WriteString(conn, "ping"); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 4)
	if _, err := io.ReadFull(reader, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != "ping" {
		t.Fatalf("echo = %q, want %q", buf, "ping")
	}
	if tunnelCalled.Load() {
		t.Fatal("external CONNECT went through the tunnel dialer")
	}
}

func TestExternalPolicyRoutes(t *testing.T) {
	origins, err := external.ParseAll([]string{"https://fonts.googleapis.com"})
	if err != nil {
		t.Fatal(err)
	}
	policy := ExternalPolicy{Allow: true, Origins: origins}

	tests := []struct {
		name   string
		scheme string
		host   string
		port   string
		route  Route
		ok     bool
	}{
		{"LAN goes through tunnel", "http", "192.168.0.3", "3000", RouteTunnel, true},
		{"allowed origin goes direct", "https", "fonts.googleapis.com", "443", RouteDirect, true},
		{"wrong scheme", "http", "fonts.googleapis.com", "443", RouteDirect, false},
		{"unlisted origin", "https", "evil.example", "443", RouteDirect, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			route, err := policy.Route(tt.scheme, tt.host, tt.port)
			if (err == nil) != tt.ok {
				t.Fatalf("error = %v, want ok = %v", err, tt.ok)
			}
			if route != tt.route {
				t.Fatalf("route = %v, want %v", route, tt.route)
			}
		})
	}

	off := ExternalPolicy{Allow: false, Origins: origins}
	if _, err := off.Route("https", "fonts.googleapis.com", "443"); err == nil {
		t.Fatal("external content should be off by default")
	}
}

func TestDirectDialerRejectsLocalAddresses(t *testing.T) {
	dialer := DirectDialer{}
	for _, address := range []string{"127.0.0.1:80", "192.168.0.3:80", "10.0.0.1:80"} {
		if _, err := dialer.DialContext(context.Background(), "tcp", address); err == nil {
			t.Fatalf("DialContext(%q) unexpectedly succeeded", address)
		}
	}
}

func TestLANPolicy(t *testing.T) {
	tests := []struct {
		host string
		want bool
	}{
		{"192.168.0.3", true},
		{"10.1.2.3", true},
		{"8.8.8.8", false},
		{"127.0.0.1", false},
		{"example.com", false},
	}

	policy := LANPolicy{}
	for _, tt := range tests {
		_, err := policy.Route("http", tt.host, "80")
		if (err == nil) != tt.want {
			t.Errorf("Route(%q) error = %v, want allowed = %v", tt.host, err, tt.want)
		}
	}
}
