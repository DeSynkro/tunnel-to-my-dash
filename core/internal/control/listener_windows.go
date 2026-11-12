//go:build windows

package control

import (
	"fmt"
	"net"
	"strings"

	"github.com/Microsoft/go-winio"
)

func listenControl(socketPath string) (net.Listener, func(), error) {
	if !strings.HasPrefix(socketPath, `\\.\pipe\`) {
		return nil, nil, fmt.Errorf("control endpoint must be a named pipe: %s", socketPath)
	}

	listener, err := winio.ListenPipe(socketPath, &winio.PipeConfig{
		// Owner-only DACL. The desktop app and the core run as the same user.
		SecurityDescriptor: "D:P(A;;GA;;;OW)",
	})
	if err != nil {
		return nil, nil, err
	}

	return listener, func() {
		listener.Close()
	}, nil
}
