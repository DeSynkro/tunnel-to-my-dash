package com.desynkro.tunneltomydash.service

import com.desynkro.tunneltomydash.data.AppSettings
import com.desynkro.tunneltomydash.data.ConnectionInfo
import com.desynkro.tunneltomydash.data.ProfileSummary
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionPolicyTest {
    private val profile = ProfileSummary(
        id = "home",
        name = "Home",
        dashboardURL = "http://192.168.1.10:3000",
        externalMode = "off",
        active = true,
    )
    private val settings = AppSettings(
        forceLANOnly = false,
        lockOnBackground = true,
        autoConnect = true,
        openPublicLinksInBrowser = false,
    )

    @Test
    fun autoConnectsWhenStoppedWithActiveProfile() {
        assertTrue(shouldAutoConnect(settings, listOf(profile), ConnectionState.Stopped))
    }

    @Test
    fun settingOffDoesNotAutoConnect() {
        assertFalse(
            shouldAutoConnect(
                settings.copy(autoConnect = false),
                listOf(profile),
                ConnectionState.Stopped,
            ),
        )
    }

    @Test
    fun noActiveProfileDoesNotAutoConnect() {
        assertFalse(
            shouldAutoConnect(
                settings,
                listOf(profile.copy(active = false)),
                ConnectionState.Stopped,
            ),
        )
    }

    @Test
    fun runningConnectionDoesNotAutoConnect() {
        assertFalse(
            shouldAutoConnect(
                settings,
                listOf(profile),
                ConnectionState.Connecting(profile.id),
            ),
        )
        assertFalse(
            shouldAutoConnect(
                settings,
                listOf(profile),
                ConnectionState.Connected(
                    ConnectionInfo(
                        proxy = "127.0.0.1:41000",
                        dashboardURL = profile.dashboardURL,
                        profileID = profile.id,
                        profileName = profile.name,
                    ),
                ),
            ),
        )
        assertFalse(
            shouldAutoConnect(
                settings,
                listOf(profile),
                ConnectionState.Error("failed"),
            ),
        )
    }
}
