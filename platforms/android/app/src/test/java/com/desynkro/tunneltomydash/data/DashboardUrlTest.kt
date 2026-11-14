package com.desynkro.tunneltomydash.data

import org.junit.Assert.assertEquals
import org.junit.Test

class DashboardUrlTest {
    @Test
    fun addsHttpToBareAddress() {
        assertEquals(
            "http://192.168.1.10:8080",
            normalizeDashboardUrl("192.168.1.10:8080"),
        )
        assertEquals(
            "http://192.168.1.10:8080",
            normalizeDashboardUrl("  192.168.1.10:8080  "),
        )
    }

    @Test
    fun keepsExplicitSchemes() {
        assertEquals(
            "http://192.168.1.10:8080",
            normalizeDashboardUrl("http://192.168.1.10:8080"),
        )
        assertEquals(
            "https://192.168.1.10:8080",
            normalizeDashboardUrl("https://192.168.1.10:8080"),
        )
    }

    @Test
    fun leavesUnsupportedSchemesForValidation() {
        assertEquals("ftp://192.168.1.10:8080", normalizeDashboardUrl("ftp://192.168.1.10:8080"))
        assertEquals("", normalizeDashboardUrl("   "))
    }
}
