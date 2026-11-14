package control

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestCredentialAPI(t *testing.T) {
	connector := &fakeConnector{proxy: "127.0.0.1:43210"}
	client := startControl(t, connector)

	resp, data := call(t, client, http.MethodPost, "/vault/create", passwordRequest{Password: "test password"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create status = %d: %s", resp.StatusCode, data)
	}
	resp, data = call(t, client, http.MethodPost, "/profiles", ProfileInput{
		Name:         "Home",
		TunnelConfig: validTunnel(t),
		DashboardURL: "http://192.168.1.11:3000",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("profile status = %d: %s", resp.StatusCode, data)
	}
	var profile ProfileSummary
	if err := json.Unmarshal(data, &profile); err != nil {
		t.Fatal(err)
	}
	base := "/profiles/" + profile.ID + "/credentials"

	resp, data = call(t, client, http.MethodPost, base, CredentialInput{
		Name:     "Jellyfin",
		URL:      "http://192.168.1.11:8096",
		Username: "alex",
		Password: "hunter2",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add status = %d: %s", resp.StatusCode, data)
	}
	if strings.Contains(string(data), "hunter2") || strings.Contains(string(data), "password") {
		t.Fatalf("credential summary leaked the secret: %s", data)
	}
	var credential CredentialSummary
	if err := json.Unmarshal(data, &credential); err != nil {
		t.Fatal(err)
	}
	if len(credential.ID) != 16 || credential.Name != "Jellyfin" {
		t.Fatalf("credential = %+v", credential)
	}

	resp, data = call(t, client, http.MethodGet, base, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d: %s", resp.StatusCode, data)
	}
	if strings.Contains(string(data), "hunter2") {
		t.Fatalf("credential list leaked the secret: %s", data)
	}
	var list []CredentialSummary
	if err := json.Unmarshal(data, &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Username != "alex" {
		t.Fatalf("credential list = %+v", list)
	}

	resp, data = call(t, client, http.MethodGet, base+"/"+credential.ID+"/secret", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("secret status = %d: %s", resp.StatusCode, data)
	}
	var secret CredentialSecret
	if err := json.Unmarshal(data, &secret); err != nil {
		t.Fatal(err)
	}
	if secret.Username != "alex" || secret.Password != "hunter2" {
		t.Fatalf("secret = %+v", secret)
	}

	resp, data = call(t, client, http.MethodPut, base+"/"+credential.ID, CredentialInput{
		Name:     "Jellyfin 2",
		Username: "sam",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update status = %d: %s", resp.StatusCode, data)
	}
	_, data = call(t, client, http.MethodGet, base+"/"+credential.ID+"/secret", nil)
	if err := json.Unmarshal(data, &secret); err != nil {
		t.Fatal(err)
	}
	if secret.Password != "hunter2" {
		t.Fatalf("blank update changed the password: %+v", secret)
	}

	resp, _ = call(t, client, http.MethodPut, base+"/"+credential.ID, CredentialInput{
		Name:     "Jellyfin 2",
		Username: "sam",
		Password: "new-secret",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("password update status = %d", resp.StatusCode)
	}
	_, data = call(t, client, http.MethodGet, base+"/"+credential.ID+"/secret", nil)
	if err := json.Unmarshal(data, &secret); err != nil {
		t.Fatal(err)
	}
	if secret.Password != "new-secret" {
		t.Fatalf("new password = %+v", secret)
	}

	resp, _ = call(t, client, http.MethodPost, base, CredentialInput{Password: "x"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty name status = %d", resp.StatusCode)
	}
	resp, _ = call(t, client, http.MethodPost, base, CredentialInput{
		Name:     "Bad URL",
		URL:      "ftp://192.168.1.11",
		Password: "x",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad URL status = %d", resp.StatusCode)
	}
	resp, _ = call(t, client, http.MethodPost, base, CredentialInput{
		Name: "No password",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty password status = %d", resp.StatusCode)
	}
	resp, _ = call(t, client, http.MethodGet, "/profiles/missing/credentials", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing profile status = %d", resp.StatusCode)
	}
	resp, _ = call(t, client, http.MethodGet, base+"/missing/secret", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing credential status = %d", resp.StatusCode)
	}

	call(t, client, http.MethodPost, "/vault/lock", nil)
	resp, _ = call(t, client, http.MethodGet, base, nil)
	if resp.StatusCode != http.StatusLocked {
		t.Fatalf("locked list status = %d", resp.StatusCode)
	}
	resp, _ = call(t, client, http.MethodGet, base+"/"+credential.ID+"/secret", nil)
	if resp.StatusCode != http.StatusLocked {
		t.Fatalf("locked secret status = %d", resp.StatusCode)
	}
	call(t, client, http.MethodPost, "/vault/unlock", passwordRequest{Password: "test password"})

	resp, _ = call(t, client, http.MethodDelete, base+"/"+credential.ID, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d", resp.StatusCode)
	}
	_, data = call(t, client, http.MethodGet, base, nil)
	if err := json.Unmarshal(data, &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("credentials after delete = %+v", list)
	}
}
