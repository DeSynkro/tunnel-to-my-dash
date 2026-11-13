package com.desynkro.tunneltomydash.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {
    @Test
    fun parsesVaultStatus() {
        val status = parseVaultStatus(
            """{"has_vault":true,"locked":false,"password_protected":true}""",
        )
        assertTrue(status.hasVault)
        assertFalse(status.locked)
        assertTrue(status.passwordProtected)
    }

    @Test
    fun parsesProfiles() {
        val profiles = parseProfiles(
            """[
                {"id":"home","name":"Home","dashboard_url":"http://192.168.0.3:3000","external_mode":"off","active":true},
                {"id":"office","name":"Office","dashboard_url":"http://192.168.0.4:3000","external_mode":"all","active":false}
            ]""",
        )
        assertEquals(2, profiles.size)
        assertEquals("home", profiles[0].id)
        assertTrue(profiles[0].active)
        assertEquals("all", profiles[1].externalMode)
        assertFalse(profiles[1].active)
    }

    @Test
    fun parsesProfileDetail() {
        val profile = parseProfileDetail(
            """{"id":"home","name":"Home","dashboard_url":"http://192.168.0.3:3000","external_mode":"origins","external_origins":["https://example.com"],"has_tunnel_config":true}""",
        )
        assertEquals("home", profile.id)
        assertTrue(profile.hasTunnelConfig)
        assertEquals("origins", profile.externalMode)
        assertEquals(listOf("https://example.com"), profile.externalOrigins)
    }

    @Test
    fun parsesSettingsAndSerializesBack() {
        val settings = parseSettings(
            """{"force_lan_only":false,"lock_on_background":true,"auto_connect":false,"open_public_links_in_browser":true}""",
        )
        assertTrue(settings.lockOnBackground)
        assertTrue(settings.openPublicLinksInBrowser)
        assertFalse(settings.forceLANOnly)

        val json = JSONObject(settings.toJson())
        assertFalse(json.getBoolean("force_lan_only"))
        assertTrue(json.getBoolean("lock_on_background"))
        assertFalse(json.getBoolean("auto_connect"))
        assertTrue(json.getBoolean("open_public_links_in_browser"))
    }

    @Test
    fun parsesConnectionInfo() {
        val info = parseConnectionInfo(
            """{"proxy":"127.0.0.1:41000","dashboard_url":"http://192.168.0.3:3000","profile_id":"home","profile_name":"Home"}""",
        )
        assertEquals("127.0.0.1:41000", info.proxy)
        assertEquals("home", info.profileID)
        assertEquals("Home", info.profileName)
    }

    @Test
    fun mapsNavigationKind() {
        assertEquals(NavigationKind.Public, parseNavigationKind("public"))
        assertEquals(NavigationKind.Private, parseNavigationKind("private"))
        assertEquals(NavigationKind.Blocked, parseNavigationKind("blocked"))
        assertEquals(NavigationKind.Blocked, parseNavigationKind("unknown"))
    }

    @Test
    fun serializesProfileDraft() {
        val newProfile = ProfileDraft(
            id = null,
            name = "Home",
            tunnelConfig = "[Interface]",
            dashboardURL = "http://192.168.0.3:3000",
            externalMode = "all",
            externalOrigins = emptyList(),
        )
        val newJson = JSONObject(newProfile.toJson())
        assertFalse(newJson.has("id"))
        assertEquals("Home", newJson.getString("name"))
        assertEquals("[Interface]", newJson.getString("tunnel_config"))
        assertEquals("all", newJson.getString("external_mode"))
        assertFalse(newJson.has("external_origins"))

        val existing = newProfile.copy(id = "home", tunnelConfig = "")
        val existingJson = JSONObject(existing.toJson())
        assertEquals("home", existingJson.getString("id"))
        assertFalse(existingJson.has("tunnel_config"))
        assertEquals("all", existingJson.getString("external_mode"))

        val origins = newProfile.copy(
            externalMode = "origins",
            externalOrigins = listOf("https://example.com"),
        )
        val originsJson = JSONObject(origins.toJson())
        assertEquals("origins", originsJson.getString("external_mode"))
        assertEquals(
            "https://example.com",
            originsJson.getJSONArray("external_origins").getString(0),
        )
    }

    @Test
    fun keepsOriginsModeWhenEditing() {
        assertEquals("off", resolveExternalMode(allowExternal = false, storedMode = "origins"))
        assertEquals("origins", resolveExternalMode(allowExternal = true, storedMode = "origins"))
        assertEquals("off", resolveExternalMode(allowExternal = false, storedMode = "off"))
        assertEquals("all", resolveExternalMode(allowExternal = true, storedMode = "off"))
        assertEquals("all", resolveExternalMode(allowExternal = true, storedMode = "all"))
    }
}
