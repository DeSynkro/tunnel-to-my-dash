package com.desynkro.tunneltomydash.data

private val interfaceHeader = Regex("(?im)^\\s*\\[interface]\\s*$")
private val peerHeader = Regex("(?im)^\\s*\\[peer]\\s*$")

internal fun looksLikeWireGuardConfig(text: String): Boolean =
    interfaceHeader.containsMatchIn(text) && peerHeader.containsMatchIn(text)
