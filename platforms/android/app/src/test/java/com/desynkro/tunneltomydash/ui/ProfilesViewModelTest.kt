package com.desynkro.tunneltomydash.ui

import com.desynkro.tunneltomydash.data.ProfileDetail
import com.desynkro.tunneltomydash.data.ProfileDraft
import com.desynkro.tunneltomydash.data.ProfileSummary
import com.desynkro.tunneltomydash.data.VaultStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test

class ProfilesViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    @Test
    fun addProfileRefreshesList() {
        val fake = FakeVaultGateway()
        val viewModel = profileViewModel(fake)

        viewModel.saveProfile(
            ProfileDraft(
                id = null,
                name = "Home",
                tunnelConfig = "[Interface]",
                dashboardURL = "http://192.168.0.3:3000",
                allowExternal = false,
            ),
        )

        assertEquals(AppScreen.Profiles, viewModel.state.value.screen)
        assertEquals(1, viewModel.state.value.profiles.size)
        assertEquals("Home", viewModel.state.value.profiles[0].name)
    }

    @Test
    fun updateProfileRefreshesList() {
        val fake = FakeVaultGateway(
            profilesResult = listOf(
                ProfileSummary("home", "Home", "http://192.168.0.3:3000", "off", true),
            ),
        )
        val viewModel = profileViewModel(fake)

        viewModel.openEditor("home")
        assertEquals("Home", viewModel.state.value.editingProfile?.name)

        viewModel.saveProfile(
            ProfileDraft(
                id = "home",
                name = "Home updated",
                tunnelConfig = "",
                dashboardURL = "http://192.168.0.3:3000",
                allowExternal = true,
            ),
        )

        assertEquals(AppScreen.Profiles, viewModel.state.value.screen)
        assertEquals("Home updated", viewModel.state.value.profiles[0].name)
        assertEquals("all", viewModel.state.value.profiles[0].externalMode)
    }

    @Test
    fun deleteProfileRefreshesList() {
        val fake = FakeVaultGateway(
            profilesResult = listOf(
                ProfileSummary("home", "Home", "http://192.168.0.3:3000", "off", true),
            ),
        )
        val viewModel = profileViewModel(fake)

        viewModel.deleteProfile("home")

        assertEquals(0, viewModel.state.value.profiles.size)
    }

    @Test
    fun setActiveProfileRefreshesList() {
        val fake = FakeVaultGateway(
            profilesResult = listOf(
                ProfileSummary("home", "Home", "http://192.168.0.3:3000", "off", true),
                ProfileSummary("office", "Office", "http://192.168.0.4:3000", "off", false),
            ),
        )
        val viewModel = profileViewModel(fake)

        viewModel.setActiveProfile("office")

        assertEquals("office", viewModel.state.value.profiles.first { it.active }.id)
    }

    @Test
    fun saveErrorKeepsEditorAndShowsError() {
        val fake = FakeVaultGateway(addError = IllegalStateException("save failed"))
        val viewModel = profileViewModel(fake)
        viewModel.openEditor(null)

        viewModel.saveProfile(
            ProfileDraft(null, "Home", "[Interface]", "http://192.168.0.3:3000", false),
        )

        assertEquals(AppScreen.EditProfile(null), viewModel.state.value.screen)
        assertNotNull(viewModel.state.value.error)
    }

    @Test
    fun openEditorLoadsDetail() {
        val detail = ProfileDetail("home", "Home", "http://192.168.0.3:3000", "all", true)
        val fake = FakeVaultGateway(profileResult = detail)
        val viewModel = profileViewModel(fake)

        viewModel.openEditor("home")

        assertEquals(detail, viewModel.state.value.editingProfile)
        assertEquals(AppScreen.EditProfile("home"), viewModel.state.value.screen)
    }

    private fun profileViewModel(fake: FakeVaultGateway): AppViewModel {
        fake.hasVaultResult = true
        fake.openResult = VaultStatus(true, false, false)
        fake.statusResult = VaultStatus(true, false, false)
        return AppViewModel(fake)
    }
}
