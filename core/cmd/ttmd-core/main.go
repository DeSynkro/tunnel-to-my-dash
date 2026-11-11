package main

import (
	"flag"
	"fmt"
	"io"
	"os"
)

var version = "0.0.0-dev"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout))
}

func run(args []string, stdout io.Writer) int {
	flags := flag.NewFlagSet("ttmd-core", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	showVersion := flags.Bool("version", false, "print the version and exit")

	if err := flags.Parse(args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}

	if *showVersion {
		fmt.Fprintf(stdout, "ttmd-core %s\n", version)
		return 0
	}

	fmt.Fprintln(stdout, "ttmd-core: no command given")
	fmt.Fprintln(stdout, "usage: ttmd-core [-version]")
	return 0
}
