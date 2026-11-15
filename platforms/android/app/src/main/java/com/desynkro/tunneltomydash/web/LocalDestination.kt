package com.desynkro.tunneltomydash.web

import java.net.InetAddress

private val ipv4Literal = Regex("^\\d{1,3}(?:\\.\\d{1,3}){3}$")
private val ipv6Literal = Regex("^[0-9a-zA-Z:.%_-]+$")

/**
 * Reports whether a URL host is a loopback or link-local destination.
 *
 * The proxy configuration removes Chromium's implicit bypass rules, but this
 * guard is defence in depth: a WebView provider that ignores the rule still
 * cannot load local services from dashboard content. Plain LAN addresses stay
 * allowed so dashboards can keep using their own network.
 *
 * Only numeric literals are parsed. Hostnames are never resolved here, which
 * avoids turning the guard into a DNS query.
 */
internal fun isLocalDestination(host: String?): Boolean {
    if (host.isNullOrBlank()) {
        return false
    }
    val normalized = host
        .trim()
        .lowercase()
        .removeSurrounding("[", "]")
        .trimEnd('.')
    if (normalized == "localhost" || normalized.endsWith(".localhost")) {
        return true
    }

    val numeric = ipv4Literal.matches(normalized) ||
        (normalized.contains(':') && ipv6Literal.matches(normalized))
    if (!numeric) {
        return false
    }

    val address = runCatching {
        InetAddress.getByName(normalized.substringBefore('%'))
    }.getOrNull() ?: return false
    return address.isLoopbackAddress ||
        address.isLinkLocalAddress ||
        address.isAnyLocalAddress
}
