package mobile

import (
	"errors"
	"fmt"

	"github.com/desynkro/tunnel-to-my-dash/core/internal/app"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/config"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/external"
	"github.com/desynkro/tunnel-to-my-dash/core/internal/vault"
)

// StartProfile starts the userspace tunnel and proxy from a stored profile and
// returns the local proxy address and dashboard metadata as JSON.
func StartProfile(profileID string) (string, error) {
	mu.Lock()
	defer mu.Unlock()

	store, err := requireUnlocked()
	if err != nil {
		return "", err
	}
	if active != nil {
		return "", errors.New("the tunnel is already running")
	}

	profile, ok := store.Profile(profileID)
	if !ok {
		return "", vault.ErrProfileNotFound
	}
	tunnelConfig, err := config.ParseTunnel(profile.TunnelConfig)
	if err != nil {
		return "", fmt.Errorf("tunnel config: %w", err)
	}

	options, err := connectionOptions(profile, store.SecuritySettings())
	if err != nil {
		return "", err
	}
	instance, err := app.Start(tunnelConfig, options)
	if err != nil {
		return "", err
	}
	if err := store.SetActiveProfile(profile.ID); err != nil {
		_ = instance.Close()
		return "", err
	}
	active = instance

	return marshal(ConnectionInfo{
		Proxy:        instance.ProxyAddr().String(),
		DashboardURL: profile.DashboardURL,
		ProfileID:    profile.ID,
		ProfileName:  profile.Name,
	})
}

func connectionOptions(profile vault.Profile, security vault.SecuritySettings) (app.Options, error) {
	mode := profile.EffectiveExternalMode()
	if security.ForceLANOnly {
		mode = external.ModeOff
	}
	return app.Options{
		AllowExternal:   mode != external.ModeOff,
		ExternalMode:    mode,
		ExternalOrigins: append([]string(nil), profile.ExternalOrigins...),
	}, nil
}
