package com.desynkro.tunneltomydash.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProxyAuthTest {
    @Test
    fun answersTheAppProxyChallenge() {
        assertEquals(
            "ttmd" to "secret",
            proxyCredentialsFor(
                proxy = "127.0.0.1:41000",
                token = "secret",
                host = "127.0.0.1",
                realm = PROXY_REALM,
            ),
        )
        assertEquals(
            "ttmd" to "secret",
            proxyCredentialsFor(
                proxy = "[::1]:41000",
                token = "secret",
                host = "::1",
                realm = PROXY_REALM,
            ),
        )
    }

    @Test
    fun ignoresOtherChallengesAndMissingTokens() {
        assertNull(
            proxyCredentialsFor(
                proxy = "127.0.0.1:41000",
                token = "secret",
                host = "127.0.0.1",
                realm = "Dashboard",
            ),
        )
        assertNull(
            proxyCredentialsFor(
                proxy = "127.0.0.1:41000",
                token = "secret",
                host = "192.168.1.10",
                realm = PROXY_REALM,
            ),
        )
        assertNull(
            proxyCredentialsFor(
                proxy = "127.0.0.1:41000",
                token = "",
                host = "127.0.0.1",
                realm = PROXY_REALM,
            ),
        )
        assertNull(
            proxyCredentialsFor(
                proxy = "not a proxy",
                token = "secret",
                host = "127.0.0.1",
                realm = PROXY_REALM,
            ),
        )
    }
}
