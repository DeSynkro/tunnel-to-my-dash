package com.desynkro.tunneltomydash.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WireGuardQrTest {
    @Test
    fun acceptsStandardConfig() {
        assertTrue(
            looksLikeWireGuardConfig(
                """
                [Interface]
                PrivateKey = abc
                Address = 10.0.0.2/32

                [Peer]
                PublicKey = def
                Endpoint = vpn.example.com:51820
                AllowedIPs = 0.0.0.0/0
                """.trimIndent(),
            ),
        )
    }

    @Test
    fun acceptsCaseAndWhitespaceVariants() {
        assertTrue(
            looksLikeWireGuardConfig(
                "[interface]\r\nAddress = 10.0.0.2/32\r\n[peer]\r\n",
            ),
        )
        assertTrue(looksLikeWireGuardConfig("  [Interface]\n  [Peer]\n  "))
    }

    @Test
    fun rejectsOtherText() {
        assertFalse(looksLikeWireGuardConfig(""))
        assertFalse(looksLikeWireGuardConfig("https://example.com"))
        assertFalse(looksLikeWireGuardConfig("[Interface]\nPrivateKey = abc"))
        assertFalse(looksLikeWireGuardConfig("[Peer]\nPublicKey = def"))
        assertFalse(looksLikeWireGuardConfig("WireGuard config: [Interface] and [Peer]"))
    }
}
