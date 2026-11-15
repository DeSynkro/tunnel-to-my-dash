package com.desynkro.tunneltomydash.web

import java.net.URI

internal const val PROXY_REALM = "Tunnel to My Dash"

/**
 * Returns credentials only for the app's own proxy challenge. A normal site
 * login on the same host, or a challenge from another proxy, must fall
 * through to the regular sign-in flow instead of receiving the proxy token.
 */
internal fun proxyCredentialsFor(
    proxy: String,
    token: String,
    host: String?,
    realm: String?,
): Pair<String, String>? {
    if (token.isBlank() || host.isNullOrBlank() || realm != PROXY_REALM) {
        return null
    }
    val proxyHost = runCatching {
        URI("http://$proxy").host
    }.getOrNull() ?: return null
    if (normalizeHost(host) != normalizeHost(proxyHost)) {
        return null
    }
    return "ttmd" to token
}

private fun normalizeHost(host: String): String =
    host.removeSurrounding("[", "]").lowercase()
