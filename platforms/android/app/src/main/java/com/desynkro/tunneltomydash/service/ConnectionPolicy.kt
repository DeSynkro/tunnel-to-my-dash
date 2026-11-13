package com.desynkro.tunneltomydash.service

import com.desynkro.tunneltomydash.data.AppSettings
import com.desynkro.tunneltomydash.data.ProfileSummary

fun shouldAutoConnect(
    settings: AppSettings,
    profiles: List<ProfileSummary>,
    state: ConnectionState,
): Boolean =
    settings.autoConnect &&
        state is ConnectionState.Stopped &&
        profiles.any { it.active }
