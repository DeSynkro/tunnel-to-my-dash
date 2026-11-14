package control

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

type fakeConnector struct {
	mu           sync.Mutex
	connects     int
	disconnects  int
	probes       int
	proxy        string
	err          error
	probeErr     error
	probeAddress string
	last         ConnectOptions
}

func (f *fakeConnector) Connect(opts ConnectOptions) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.connects++
	f.last = opts
	if f.err != nil {
		return "", f.err
	}
	return f.proxy, nil
}

func (f *fakeConnector) Disconnect() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.disconnects++
	return nil
}

func (f *fakeConnector) Probe(
	opts ConnectOptions,
	network, address string,
	timeout time.Duration,
) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.probes++
	f.probeAddress = address
	return f.probeErr
}

func startControl(t *testing.T, connector Connector) *http.Client {
	t.Helper()

	dir := t.TempDir()
	socketPath := testControlEndpoint(t)
	vaultPath := filepath.Join(dir, "vault.json")

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- Serve(ctx, socketPath, vaultPath, connector)
	}()

	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("control server: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Error("control server did not stop")
		}
	})

	deadline := time.Now().Add(5 * time.Second)
	for {
		if waitControl(socketPath) {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("control server exited: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for the control socket")
		}
		time.Sleep(10 * time.Millisecond)
	}

	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			return dialControl(ctx, socketPath)
		},
	}
	return &http.Client{Transport: transport}
}

func call(t *testing.T, client *http.Client, method, path string, body any) (*http.Response, []byte) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, "http://control"+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp, data
}

func validTunnel(t *testing.T) string {
	t.Helper()

	private, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	peer, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	psk, err := wgtypes.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}

	return fmt.Sprintf(`[Interface]
PrivateKey = %s
Address = 10.66.0.2/24
MTU = 1420

[Peer]
PublicKey = %s
PresharedKey = %s
Endpoint = 203.0.113.10:51820
AllowedIPs = 0.0.0.0/0
`, private, peer.PublicKey(), psk)
}

func decodeStatus(t *testing.T, data []byte) Status {
	t.Helper()
	var status Status
	if err := json.Unmarshal(data, &status); err != nil {
		t.Fatal(err)
	}
	return status
}

func TestControlFlow(t *testing.T) {
	connector := &fakeConnector{proxy: "127.0.0.1:43210"}
	client := startControl(t, connector)

	resp, data := call(t, client, http.MethodGet, "/status", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	status := decodeStatus(t, data)
	if status.HasVault || !status.Locked {
		t.Fatalf("initial status = %+v", status)
	}

	resp, data = call(t, client, http.MethodPost, "/vault/create", passwordRequest{Password: "test password"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create status = %d: %s", resp.StatusCode, data)
	}
	status = decodeStatus(t, data)
	if !status.HasVault || status.Locked || !status.PasswordProtected {
		t.Fatalf("created status = %+v", status)
	}

	profileBody := ProfileInput{
		Name:            "Home",
		TunnelConfig:    validTunnel(t),
		DashboardURL:    "http://192.168.1.10:3000",
		AllowExternal:   true,
		ExternalMode:    "origins",
		ExternalOrigins: []string{" HTTPS://Fonts.GoogleAPIs.com/ ", "https://fonts.googleapis.com"},
	}
	resp, data = call(t, client, http.MethodPost, "/profiles", profileBody)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("profile status = %d: %s", resp.StatusCode, data)
	}
	if strings.Contains(string(data), "PrivateKey") || strings.Contains(string(data), "tunnel_config") {
		t.Fatalf("profile response leaked the tunnel config: %s", data)
	}
	var profile ProfileSummary
	if err := json.Unmarshal(data, &profile); err != nil {
		t.Fatal(err)
	}
	if profile.ID == "" || profile.Name != "Home" {
		t.Fatalf("profile = %+v", profile)
	}
	if !profile.AllowExternal || profile.ExternalMode != "origins" ||
		len(profile.ExternalOrigins) != 1 ||
		profile.ExternalOrigins[0] != "https://fonts.googleapis.com" {
		t.Fatalf("external profile = %+v", profile)
	}

	resp, data = call(t, client, http.MethodGet, "/status", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if strings.Contains(string(data), "PrivateKey") || strings.Contains(string(data), "tunnel_config") {
		t.Fatalf("status leaked the tunnel config: %s", data)
	}
	status = decodeStatus(t, data)
	if len(status.Profiles) != 1 || status.ActiveProfile != profile.ID {
		t.Fatalf("status = %+v", status)
	}

	resp, data = call(t, client, http.MethodPost, "/profiles/"+profile.ID+"/check", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("check status = %d: %s", resp.StatusCode, data)
	}
	var check map[string]bool
	if err := json.Unmarshal(data, &check); err != nil {
		t.Fatal(err)
	}
	if !check["reachable"] {
		t.Fatalf("check response = %+v", check)
	}
	connector.mu.Lock()
	probes := connector.probes
	probeAddress := connector.probeAddress
	connector.mu.Unlock()
	if probes != 1 || probeAddress != "192.168.1.10:3000" {
		t.Fatalf("probes = %d, address = %q", probes, probeAddress)
	}

	connector.mu.Lock()
	connector.probeErr = errors.New("unreachable")
	connector.mu.Unlock()
	resp, data = call(t, client, http.MethodPost, "/profiles/"+profile.ID+"/check", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unreachable check status = %d: %s", resp.StatusCode, data)
	}
	if err := json.Unmarshal(data, &check); err != nil {
		t.Fatal(err)
	}
	if check["reachable"] {
		t.Fatalf("unreachable check response = %+v", check)
	}
	connector.mu.Lock()
	connector.probeErr = nil
	connector.mu.Unlock()

	resp, data = call(t, client, http.MethodPost, "/connect", connectRequest{ProfileID: profile.ID})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("connect status = %d: %s", resp.StatusCode, data)
	}
	var connected map[string]string
	if err := json.Unmarshal(data, &connected); err != nil {
		t.Fatal(err)
	}
	if connected["proxy"] != "127.0.0.1:43210" || connected["dashboard_url"] != "http://192.168.1.10:3000" {
		t.Fatalf("connect response = %+v", connected)
	}
	connector.mu.Lock()
	connects := connector.connects
	last := connector.last
	connector.mu.Unlock()
	if connects != 1 {
		t.Fatalf("connector connects = %d, want 1", connects)
	}
	if !last.AllowExternal || last.ExternalMode != "origins" ||
		len(last.ExternalOrigins) != 1 ||
		last.ExternalOrigins[0] != "https://fonts.googleapis.com" {
		t.Fatalf("connector options = %+v", last)
	}

	_, data = call(t, client, http.MethodGet, "/status", nil)
	status = decodeStatus(t, data)
	if !status.Connected || status.Proxy != "127.0.0.1:43210" {
		t.Fatalf("connected status = %+v", status)
	}

	resp, _ = call(t, client, http.MethodPost, "/disconnect", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("disconnect status = %d", resp.StatusCode)
	}
	_, data = call(t, client, http.MethodGet, "/status", nil)
	status = decodeStatus(t, data)
	if status.Connected {
		t.Fatalf("still connected: %+v", status)
	}

	resp, _ = call(t, client, http.MethodPost, "/vault/lock", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("lock status = %d", resp.StatusCode)
	}
	resp, data = call(t, client, http.MethodGet, "/status", nil)
	status = decodeStatus(t, data)
	if !status.Locked || len(status.Profiles) != 0 {
		t.Fatalf("locked status = %+v", status)
	}

	resp, _ = call(t, client, http.MethodPost, "/vault/unlock", passwordRequest{Password: "wrong"})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong unlock status = %d", resp.StatusCode)
	}
	resp, _ = call(t, client, http.MethodPost, "/vault/unlock", passwordRequest{Password: "test password"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unlock status = %d", resp.StatusCode)
	}

	resp, data = call(t, client, http.MethodPut, "/profiles/"+profile.ID, ProfileInput{
		Name:         "Home 2",
		DashboardURL: "http://192.168.1.10:3000",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update status = %d: %s", resp.StatusCode, data)
	}
	var updated ProfileSummary
	if err := json.Unmarshal(data, &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Home 2" {
		t.Fatalf("updated profile = %+v", updated)
	}

	resp, _ = call(t, client, http.MethodPost, "/profiles/"+profile.ID+"/activate", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("activate status = %d", resp.StatusCode)
	}

	resp, _ = call(t, client, http.MethodDelete, "/profiles/"+profile.ID, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d", resp.StatusCode)
	}
	_, data = call(t, client, http.MethodGet, "/status", nil)
	status = decodeStatus(t, data)
	if len(status.Profiles) != 0 {
		t.Fatalf("profiles after delete = %+v", status.Profiles)
	}

	resp, _ = call(t, client, http.MethodPost, "/vault/create", passwordRequest{Password: "again"})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("second create status = %d", resp.StatusCode)
	}
}

func TestSecuritySettings(t *testing.T) {
	connector := &fakeConnector{proxy: "127.0.0.1:43210"}
	client := startControl(t, connector)

	resp, _ := call(t, client, http.MethodPost, "/vault/create", passwordRequest{Password: "pw"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create status = %d", resp.StatusCode)
	}

	resp, data := call(t, client, http.MethodPost, "/profiles", ProfileInput{
		Name:            "Home",
		TunnelConfig:    validTunnel(t),
		DashboardURL:    "http://192.168.1.10:3000",
		AllowExternal:   true,
		ExternalMode:    "origins",
		ExternalOrigins: []string{"https://example.com"},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("profile status = %d: %s", resp.StatusCode, data)
	}
	var profile ProfileSummary
	if err := json.Unmarshal(data, &profile); err != nil {
		t.Fatal(err)
	}

	_, data = call(t, client, http.MethodGet, "/status", nil)
	status := decodeStatus(t, data)
	if status.Security.ForceLANOnly || status.Security.LockAfterIdle || status.Security.IdleMinutes != 15 {
		t.Fatalf("default security = %+v", status.Security)
	}

	resp, data = call(t, client, http.MethodPut, "/security", securityRequest{
		ForceLANOnly:  true,
		LockAfterIdle: true,
		IdleMinutes:   30,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("security status = %d: %s", resp.StatusCode, data)
	}
	status = decodeStatus(t, data)
	if !status.Security.ForceLANOnly || !status.Security.LockAfterIdle ||
		status.Security.IdleMinutes != 30 {
		t.Fatalf("security = %+v", status.Security)
	}

	resp, _ = call(t, client, http.MethodPost, "/connect", connectRequest{ProfileID: profile.ID})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("connect status = %d", resp.StatusCode)
	}
	connector.mu.Lock()
	last := connector.last
	connector.mu.Unlock()
	if last.ExternalMode != "off" || last.AllowExternal {
		t.Fatalf("forced LAN-only options = %+v", last)
	}

	resp, data = call(t, client, http.MethodPut, "/security", securityRequest{
		IdleMinutes: 15,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("security reset status = %d: %s", resp.StatusCode, data)
	}
	resp, _ = call(t, client, http.MethodPost, "/connect", connectRequest{ProfileID: profile.ID})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("second connect status = %d", resp.StatusCode)
	}
	connector.mu.Lock()
	last = connector.last
	connector.mu.Unlock()
	if last.ExternalMode != "origins" || !last.AllowExternal {
		t.Fatalf("profile options after reset = %+v", last)
	}
}

func TestControlErrors(t *testing.T) {
	connector := &fakeConnector{proxy: "127.0.0.1:1"}
	client := startControl(t, connector)

	resp, _ := call(t, client, http.MethodPost, "/vault/unlock", passwordRequest{Password: "x"})
	if resp.StatusCode != http.StatusLocked {
		t.Fatalf("unlock without vault status = %d", resp.StatusCode)
	}

	resp, _ = call(t, client, http.MethodPost, "/profiles", ProfileInput{
		Name:         "Home",
		TunnelConfig: validTunnel(t),
		DashboardURL: "http://192.168.1.10:3000",
	})
	if resp.StatusCode != http.StatusLocked {
		t.Fatalf("add profile without vault status = %d", resp.StatusCode)
	}

	resp, _ = call(t, client, http.MethodPut, "/security", securityRequest{IdleMinutes: 15})
	if resp.StatusCode != http.StatusLocked {
		t.Fatalf("security without vault status = %d", resp.StatusCode)
	}

	resp, _ = call(t, client, http.MethodPost, "/vault/create", passwordRequest{Password: "pw"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create status = %d", resp.StatusCode)
	}

	resp, data := call(t, client, http.MethodPost, "/profiles", ProfileInput{
		Name:         "Home",
		TunnelConfig: "nope",
		DashboardURL: "http://192.168.1.10:3000",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid profile status = %d: %s", resp.StatusCode, data)
	}

	resp, data = call(t, client, http.MethodPost, "/profiles", ProfileInput{
		Name:            "Home",
		TunnelConfig:    validTunnel(t),
		DashboardURL:    "http://192.168.1.10:3000",
		AllowExternal:   true,
		ExternalOrigins: []string{"https://fonts.example/path"},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid external origin status = %d: %s", resp.StatusCode, data)
	}

	resp, _ = call(t, client, http.MethodPut, "/security", securityRequest{IdleMinutes: 7})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid security status = %d", resp.StatusCode)
	}

	resp, _ = call(t, client, http.MethodPost, "/connect", connectRequest{ProfileID: "missing"})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("connect missing profile status = %d", resp.StatusCode)
	}

	resp, _ = call(t, client, http.MethodPost, "/profiles/missing/check", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("check missing profile status = %d", resp.StatusCode)
	}

	resp, _ = call(t, client, http.MethodPut, "/profiles/missing", ProfileInput{Name: "x"})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("update missing profile status = %d", resp.StatusCode)
	}

	connector.mu.Lock()
	connector.err = errors.New("boom")
	connector.mu.Unlock()

	resp, _ = call(t, client, http.MethodPost, "/profiles", ProfileInput{
		Name:         "Home",
		TunnelConfig: validTunnel(t),
		DashboardURL: "http://192.168.1.10:3000",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add profile status = %d", resp.StatusCode)
	}
}

func TestControlOpenError(t *testing.T) {
	dir := t.TempDir()
	vaultPath := filepath.Join(dir, "vault.json")
	if err := os.WriteFile(vaultPath, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}

	service, err := New(vaultPath, &fakeConnector{})
	if err != nil {
		t.Fatal(err)
	}

	service.mu.Lock()
	status := service.statusLocked()
	service.mu.Unlock()

	if !status.HasVault || !status.Locked || status.Error == "" {
		t.Fatalf("status = %+v", status)
	}
}
