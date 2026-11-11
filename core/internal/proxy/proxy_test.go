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
)

type dialFunc func(ctx context.Context, network, address string) (net.Conn, error)

func (f dialFunc) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return f(ctx, network, address)
}

type allowAll struct{}

func (allowAll) Allow(host, port string) error { return nil }

type denyAll struct{}

func (denyAll) Allow(host, port string) error { return errors.New("blocked") }

func startProxy(t *testing.T, dialer Dialer, policy Policy) *url.URL {
	t.Helper()
	s := New(dialer, policy)
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
	proxyURL := startProxy(t, dialer, allowAll{})

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
	proxyURL := startProxy(t, dialer, denyAll{})

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
	proxyURL := startProxy(t, dialer, allowAll{})

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
	proxyURL := startProxy(t, dialer, allowAll{})

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
	proxyURL := startProxy(t, dialer, allowAll{})

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
		err := policy.Allow(tt.host, "80")
		if (err == nil) != tt.want {
			t.Errorf("Allow(%q) error = %v, want allowed = %v", tt.host, err, tt.want)
		}
	}
}
