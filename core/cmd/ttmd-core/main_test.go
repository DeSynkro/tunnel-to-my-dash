package main

import (
	"bytes"
	"testing"
)

func TestRunVersion(t *testing.T) {
	var out bytes.Buffer

	if code := run([]string{"-version"}, &out); code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}

	if got, want := out.String(), "ttmd-core 0.0.0-dev\n"; got != want {
		t.Fatalf("output = %q, want %q", got, want)
	}
}

func TestRunUnknownFlag(t *testing.T) {
	var out bytes.Buffer

	if code := run([]string{"-nope"}, &out); code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
}
