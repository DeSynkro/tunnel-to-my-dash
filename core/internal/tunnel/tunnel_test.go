package tunnel

import (
	"context"
	"io"
	"net"
	"testing"
	"time"
)

func TestPairEcho(t *testing.T) {
	pair := startPair(t)

	listener, err := pair.a.Listen("tcp", "10.66.0.1:8080")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		io.Copy(conn, conn)
	}()

	deadline := time.Now().Add(10 * time.Second)

	var conn net.Conn
	for {
		attemptCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		conn, err = pair.b.DialContext(attemptCtx, "tcp", "10.66.0.1:8080")
		cancel()
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("dial through tunnel: %v", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	defer conn.Close()

	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}

	buf := make([]byte, len("hello"))
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != "hello" {
		t.Fatalf("echo = %q, want %q", buf, "hello")
	}
}

func TestDialRejectsNonTCP(t *testing.T) {
	pair := startPair(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	if _, err := pair.b.DialContext(ctx, "udp", "10.66.0.1:8080"); err == nil {
		t.Fatal("expected an error for a UDP dial")
	}
}

func TestDialRejectsHostname(t *testing.T) {
	pair := startPair(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	if _, err := pair.b.DialContext(ctx, "tcp", "example.com:80"); err == nil {
		t.Fatal("expected an error for a hostname")
	}
}

func TestStartRejectsEmptyConfig(t *testing.T) {
	if _, err := Start(Config{}); err == nil {
		t.Fatal("expected an error")
	}
}

func TestCloseIsIdempotent(t *testing.T) {
	pair := startPair(t)
	pair.a.Close()
	pair.a.Close()
}
