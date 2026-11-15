package vault

import "testing"

func TestValidKDFBounds(t *testing.T) {
	tests := []struct {
		name   string
		params kdfParams
		want   bool
	}{
		{name: "default", params: defaultKDF, want: true},
		{name: "minimum", params: kdfParams{Time: 1, Memory: 8, Threads: 1}, want: true},
		{name: "maximum", params: kdfParams{Time: maxKDFTime, Memory: maxKDFMemory, Threads: maxKDFThreads}, want: true},
		{name: "zero time", params: kdfParams{Time: 0, Memory: 64 * 1024, Threads: 2}, want: false},
		{name: "time above cap", params: kdfParams{Time: maxKDFTime + 1, Memory: 64 * 1024, Threads: 2}, want: false},
		{name: "zero threads", params: kdfParams{Time: 3, Memory: 64 * 1024, Threads: 0}, want: false},
		{name: "threads above cap", params: kdfParams{Time: 3, Memory: 64 * 1024, Threads: maxKDFThreads + 1}, want: false},
		{name: "memory below threads", params: kdfParams{Time: 3, Memory: 8, Threads: 2}, want: false},
		{name: "memory above cap", params: kdfParams{Time: 3, Memory: maxKDFMemory + 1, Threads: 2}, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validKDF(tt.params); got != tt.want {
				t.Fatalf("validKDF(%+v) = %v, want %v", tt.params, got, tt.want)
			}
		})
	}
}
