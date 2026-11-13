package com.desynkro.tunneltomydash.data

import org.json.JSONArray
import org.json.JSONObject

data class VaultStatus(
    val hasVault: Boolean,
    val locked: Boolean,
    val passwordProtected: Boolean,
)

data class ProfileSummary(
    val id: String,
    val name: String,
    val dashboardURL: String,
    val externalMode: String,
    val active: Boolean,
)

data class ProfileDetail(
    val id: String,
    val name: String,
    val dashboardURL: String,
    val externalMode: String,
    val externalOrigins: List<String>,
    val hasTunnelConfig: Boolean,
)

data class ProfileDraft(
    val id: String?,
    val name: String,
    val tunnelConfig: String,
    val dashboardURL: String,
    val externalMode: String,
    val externalOrigins: List<String>,
)

data class AppSettings(
    val forceLANOnly: Boolean,
    val lockOnBackground: Boolean,
    val autoConnect: Boolean,
    val openPublicLinksInBrowser: Boolean,
)

data class ConnectionInfo(
    val proxy: String,
    val dashboardURL: String,
    val profileID: String,
    val profileName: String,
)

enum class NavigationKind {
    Private,
    Public,
    Blocked,
}

internal fun parseVaultStatus(raw: String): VaultStatus {
    val json = JSONObject(raw)
    return VaultStatus(
        hasVault = json.optBoolean("has_vault", false),
        locked = json.optBoolean("locked", true),
        passwordProtected = json.optBoolean("password_protected", false),
    )
}

internal fun parseProfiles(raw: String): List<ProfileSummary> {
    val array = JSONArray(raw)
    return (0 until array.length()).map { index ->
        parseProfileSummary(array.getJSONObject(index))
    }
}

internal fun parseProfileSummary(raw: String): ProfileSummary =
    parseProfileSummary(JSONObject(raw))

private fun parseProfileSummary(json: JSONObject): ProfileSummary = ProfileSummary(
    id = json.optString("id"),
    name = json.optString("name"),
    dashboardURL = json.optString("dashboard_url"),
    externalMode = json.optString("external_mode", "off"),
    active = json.optBoolean("active", false),
)

internal fun parseProfileDetail(raw: String): ProfileDetail {
    val json = JSONObject(raw)
    val origins = json.optJSONArray("external_origins")?.let { array ->
        (0 until array.length()).map { index -> array.getString(index) }
    }.orEmpty()
    return ProfileDetail(
        id = json.optString("id"),
        name = json.optString("name"),
        dashboardURL = json.optString("dashboard_url"),
        externalMode = json.optString("external_mode", "off"),
        externalOrigins = origins,
        hasTunnelConfig = json.optBoolean("has_tunnel_config", false),
    )
}

internal fun parseSettings(raw: String): AppSettings {
    val json = JSONObject(raw)
    return AppSettings(
        forceLANOnly = json.optBoolean("force_lan_only", false),
        lockOnBackground = json.optBoolean("lock_on_background", true),
        autoConnect = json.optBoolean("auto_connect", false),
        openPublicLinksInBrowser = json.optBoolean("open_public_links_in_browser", false),
    )
}

internal fun parseConnectionInfo(raw: String): ConnectionInfo {
    val json = JSONObject(raw)
    return ConnectionInfo(
        proxy = json.optString("proxy"),
        dashboardURL = json.optString("dashboard_url"),
        profileID = json.optString("profile_id"),
        profileName = json.optString("profile_name"),
    )
}

internal fun parseNavigationKind(raw: String): NavigationKind = when (raw) {
    "private" -> NavigationKind.Private
    "public" -> NavigationKind.Public
    else -> NavigationKind.Blocked
}

internal fun ProfileDraft.toJson(): String = JSONObject().apply {
    id?.let { put("id", it) }
    put("name", name)
    if (tunnelConfig.isNotBlank()) {
        put("tunnel_config", tunnelConfig)
    }
    put("dashboard_url", dashboardURL)
    put("external_mode", externalMode)
    if (externalOrigins.isNotEmpty()) {
        put("external_origins", JSONArray(externalOrigins))
    }
}.toString()

/**
 * Maps the "Allow external content" switch to a stored mode. A profile that
 * already uses an exact-origin allowlist keeps that mode: the Android editor
 * can turn external content off, but cannot widen it to "all" by accident.
 */
internal fun resolveExternalMode(
    allowExternal: Boolean,
    storedMode: String,
    storedOrigins: List<String> = emptyList(),
): String = when {
    !allowExternal -> "off"
    storedMode == "origins" || storedOrigins.isNotEmpty() -> "origins"
    else -> "all"
}

internal fun AppSettings.toJson(): String = JSONObject().apply {
    put("force_lan_only", forceLANOnly)
    put("lock_on_background", lockOnBackground)
    put("auto_connect", autoConnect)
    put("open_public_links_in_browser", openPublicLinksInBrowser)
}.toString()
