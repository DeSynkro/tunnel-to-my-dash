package control

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/vault"
)

type passwordRequest struct {
	Password string `json:"password"`
}

type changePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

type connectRequest struct {
	ProfileID string `json:"profile_id"`
}

func Serve(ctx context.Context, socketPath, vaultPath string, connector Connector) error {
	service, err := New(vaultPath, connector)
	if err != nil {
		return err
	}
	return service.Serve(ctx, socketPath)
}

func (s *Service) Serve(ctx context.Context, socketPath string) error {
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o700); err != nil {
		return err
	}
	_ = os.Remove(socketPath)

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(socketPath)

	if err := os.Chmod(socketPath, 0o600); err != nil {
		return err
	}

	server := &http.Server{
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.Serve(listener)
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		s.close()
		return nil
	case err := <-errCh:
		s.close()
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (s *Service) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /status", s.handleStatus)
	mux.HandleFunc("POST /vault/create", s.handleCreateVault)
	mux.HandleFunc("POST /vault/unlock", s.handleUnlock)
	mux.HandleFunc("POST /vault/lock", s.handleLock)
	mux.HandleFunc("POST /vault/password", s.handleChangePassword)

	mux.HandleFunc("POST /profiles", s.handleAddProfile)
	mux.HandleFunc("PUT /profiles/{id}", s.handleUpdateProfile)
	mux.HandleFunc("DELETE /profiles/{id}", s.handleDeleteProfile)
	mux.HandleFunc("POST /profiles/{id}/activate", s.handleActivateProfile)
	mux.HandleFunc("POST /profiles/{id}/check", s.handleCheckProfile)

	mux.HandleFunc("POST /connect", s.handleConnect)
	mux.HandleFunc("POST /disconnect", s.handleDisconnect)

	return mux
}

func (s *Service) handleStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	writeJSON(w, http.StatusOK, s.statusLocked())
}

func (s *Service) handleCreateVault(w http.ResponseWriter, r *http.Request) {
	var req passwordRequest
	if !readJSON(w, r, &req) {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.createVault(req.Password); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.statusLocked())
}

func (s *Service) handleUnlock(w http.ResponseWriter, r *http.Request) {
	var req passwordRequest
	if !readJSON(w, r, &req) {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.unlock(req.Password); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.statusLocked())
}

func (s *Service) handleLock(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lock()
	writeJSON(w, http.StatusOK, s.statusLocked())
}

func (s *Service) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var req changePasswordRequest
	if !readJSON(w, r, &req) {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.changePassword(req.OldPassword, req.NewPassword); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.statusLocked())
}

func (s *Service) handleAddProfile(w http.ResponseWriter, r *http.Request) {
	var input ProfileInput
	if !readJSON(w, r, &input) {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	profile, err := s.addProfile(input)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, profile)
}

func (s *Service) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	var input ProfileInput
	if !readJSON(w, r, &input) {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	profile, err := s.updateProfile(r.PathValue("id"), input)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (s *Service) handleDeleteProfile(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.deleteProfile(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleActivateProfile(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.activateProfile(r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.statusLocked())
}

func (s *Service) handleCheckProfile(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	opts, address, err := s.probeTarget(r.PathValue("id"))
	s.mu.Unlock()
	if err != nil {
		writeError(w, err)
		return
	}

	reachable := true
	if err := s.connector.Probe(opts, "tcp", address, 3*time.Second); err != nil {
		reachable = false
	}
	writeJSON(w, http.StatusOK, map[string]bool{"reachable": reachable})
}

func (s *Service) handleConnect(w http.ResponseWriter, r *http.Request) {
	var req connectRequest
	if !readJSON(w, r, &req) {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	proxy, dashboardURL, err := s.connect(req.ProfileID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"proxy":         proxy,
		"dashboard_url": dashboardURL,
	})
}

func (s *Service) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.disconnect()
	writeJSON(w, http.StatusOK, s.statusLocked())
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, vault.ErrWrongPassword):
		status = http.StatusUnauthorized
	case errors.Is(err, vault.ErrLockedOut):
		status = http.StatusTooManyRequests
	case errors.Is(err, vault.ErrLocked):
		status = http.StatusLocked
	case errors.Is(err, vault.ErrProfileNotFound):
		status = http.StatusNotFound
	case errors.Is(err, vault.ErrProfileExists), errors.Is(err, vault.ErrExists):
		status = http.StatusConflict
	case errors.Is(err, vault.ErrInvalidProfile):
		status = http.StatusBadRequest
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
