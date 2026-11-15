package com.desynkro.tunneltomydash.web

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalDestinationTest {
    @Test
    fun blocksLoopbackNamesAndAddresses() {
        for (host in listOf(
            "localhost",
            "LOCALHOST.",
            "dashboard.localhost",
            "127.0.0.1",
            "127.1.2.3",
            "[::1]",
            "0:0:0:0:0:0:0:1",
            "::ffff:127.0.0.1",
            "0.0.0.0",
            "::",
        )) {
            assertTrue(host, isLocalDestination(host))
        }
    }

    @Test
    fun blocksLinkLocalAddresses() {
        for (host in listOf(
            "169.254.1.1",
            "169.254.169.254",
            "[fe80::1]",
            "fe80::1%25wlan0",
        )) {
            assertTrue(host, isLocalDestination(host))
        }
    }

    @Test
    fun allowsLanAndPublicDestinations() {
        for (host in listOf(
            "192.168.1.10",
            "10.0.0.5",
            "172.16.0.1",
            "100.64.0.1",
            "fd00::1",
            "8.8.8.8",
            "example.com",
            "dashboard.home.arpa",
            "",
            null,
        )) {
            assertFalse(host ?: "null", isLocalDestination(host))
        }
    }

    @Test
    fun doesNotResolveHostnamesThatPointAtLoopback() {
        assertFalse(isLocalDestination("localtest.me"))
    }
}
