package com.desynkro.tunneltomydash.data

private val httpScheme = Regex("(?i)^https?://")

/**
 * Accepts a bare LAN address such as 192.168.1.10:3000 and supplies the
 * default http scheme. Explicit http/https URLs are left alone; other
 * schemes are returned unchanged so the Go validator can reject them.
 */
internal fun normalizeDashboardUrl(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.isEmpty() || httpScheme.containsMatchIn(trimmed)) {
        return trimmed
    }
    if (trimmed.startsWith("//")) {
        return "http:$trimmed"
    }
    if (trimmed.contains("://")) {
        return trimmed
    }
    return "http://$trimmed"
}
