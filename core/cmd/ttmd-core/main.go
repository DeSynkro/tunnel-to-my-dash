package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/app"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
)

var version = "0.0.0-dev"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout))
}

func run(args []string, stdout io.Writer) int {
	if len(args) == 0 {
		usage(stdout)
		return 0
	}

	switch args[0] {
	case "-version", "--version":
		fmt.Fprintf(stdout, "ttmd-core %s\n", version)
		return 0
	case "run":
		return runServe(args[1:], stdout)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", args[0])
		usage(os.Stderr)
		return 2
	}
}

func runServe(args []string, stdout io.Writer) int {
	flags := flag.NewFlagSet("ttmd-core run", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	tunnelPath := flags.String("tunnel", "", "path to a WireGuard config")
	configPath := flags.String("config", "", "path to the app config")

	if err := flags.Parse(args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if *tunnelPath == "" || *configPath == "" {
		fmt.Fprintln(os.Stderr, "run requires --tunnel and --config")
		return 2
	}

	tunnelCfg, err := config.LoadTunnel(*tunnelPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if _, err := config.LoadApp(*configPath); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}

	instance, err := app.Start(tunnelCfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer instance.Close()

	fmt.Fprintf(stdout, "proxy listening on %s\n", instance.ProxyAddr())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()

	return 0
}

func usage(w io.Writer) {
	fmt.Fprintln(w, "usage: ttmd-core <command> [options]")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "commands:")
	fmt.Fprintln(w, "  run       start the tunnel and the local proxy")
	fmt.Fprintln(w, "  -version  print the version")
}
