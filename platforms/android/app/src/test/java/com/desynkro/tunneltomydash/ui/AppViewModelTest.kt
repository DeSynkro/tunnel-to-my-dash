package com.desynkro.tunneltomydash.ui

import com.desynkro.tunneltomydash.data.AppSettings
import com.desynkro.tunneltomydash.data.NavigationKind
import com.desynkro.tunneltomydash.data.ProfileDetail
import com.desynkro.tunneltomydash.data.ProfileDraft
import com.desynkro.tunneltomydash.data.ProfileSummary
import com.desynkro.tunneltomydash.data.VaultGateway
import com.desynkro.tunneltomydash.data.VaultStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AppViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    @Test
    fun bootstrapWithoutVaultShowsSetup() {
        val viewModel = AppViewModel(FakeVaultGateway(hasVaultResult = false))
        assertEquals(AppScreen.Setup, viewModel.state.value.screen)
    }

    @Test
    fun bootstrapKeyfileShowsProfiles() {
        val profile = ProfileSummary("home", "Home", "http://192.168.0.3:3000", "off", true)
        val viewModel = AppViewModel(
            FakeVaultGateway(
                hasVaultResult = true,
                openResult = VaultStatus(true, false, false),
                profilesResult = listOf(profile),
            ),
        )
        assertEquals(AppScreen.Profiles, viewModel.state.value.screen)
        assertEquals(1, viewModel.state.value.profiles.size)
    }

    @Test
    fun bootstrapPasswordVaultShowsUnlock() {
        val viewModel = AppViewModel(
            FakeVaultGateway(
                hasVaultResult = true,
                openResult = VaultStatus(true, true, true),
                statusResult = VaultStatus(true, true, true),
            ),
        )
        assertEquals(AppScreen.Unlock, viewModel.state.value.screen)
    }

    @Test
    fun createKeyfileVaultShowsProfiles() {
        val fake = FakeVaultGateway(
            hasVaultResult = false,
            createResult = VaultStatus(true, false, false),
        )
        val viewModel = AppViewModel(fake)
        assertEquals(AppScreen.Setup, viewModel.state.value.screen)

        viewModel.createVault("", usePassword = false)

        assertTrue(fake.hasVaultResult)
        assertEquals(AppScreen.Profiles, viewModel.state.value.screen)
    }

    @Test
    fun wrongPasswordKeepsUnlockAndShowsError() {
        val fake = FakeVaultGateway(
            hasVaultResult = true,
            openResult = VaultStatus(true, true, true),
            statusResult = VaultStatus(true, true, true),
            unlockError = IllegalStateException("wrong password"),
        )
        val viewModel = AppViewModel(fake)
        assertEquals(AppScreen.Unlock, viewModel.state.value.screen)

        viewModel.unlock("bad")

        assertEquals(AppScreen.Unlock, viewModel.state.value.screen)
        assertNotNull(viewModel.state.value.error)
    }

    @Test
    fun correctPasswordShowsProfiles() {
        val fake = FakeVaultGateway(
            hasVaultResult = true,
            openResult = VaultStatus(true, true, true),
            statusResult = VaultStatus(true, true, true),
        )
        val viewModel = AppViewModel(fake)

        viewModel.unlock("correct horse")

        assertEquals(AppScreen.Profiles, viewModel.state.value.screen)
    }

    @Test
    fun lockingPasswordVaultReturnsToUnlock() {
        val fake = FakeVaultGateway(
            hasVaultResult = true,
            openResult = VaultStatus(true, true, true),
            statusResult = VaultStatus(true, true, true),
        )
        val viewModel = AppViewModel(fake)
        viewModel.unlock("correct horse")
        assertEquals(AppScreen.Profiles, viewModel.state.value.screen)

        viewModel.lock()

        assertEquals(AppScreen.Unlock, viewModel.state.value.screen)
        assertTrue(viewModel.state.value.vaultStatus.locked)
    }
}

private class FakeVaultGateway(
    var hasVaultResult: Boolean = false,
    var openResult: VaultStatus = VaultStatus(true, false, false),
    var createResult: VaultStatus = VaultStatus(true, false, false),
    var unlockError: Throwable? = null,
    var profilesResult: List<ProfileSummary> = emptyList(),
    var settingsResult: AppSettings = AppSettings(false, true, false, false),
    var statusResult: VaultStatus = VaultStatus(true, false, false),
) : VaultGateway {
    override fun hasVault(): Boolean = hasVaultResult

    override suspend fun createVault(password: String): VaultStatus {
        hasVaultResult = true
        statusResult = createResult
        return createResult
    }

    override suspend fun openVault(): VaultStatus {
        statusResult = openResult
        return openResult
    }

    override suspend fun unlock(password: String) {
        unlockError?.let { throw it }
        statusResult = statusResult.copy(locked = false)
    }

    override fun lock() {
        statusResult = statusResult.copy(locked = true)
    }

    override fun status(): VaultStatus = statusResult

    override suspend fun profiles(): List<ProfileSummary> = profilesResult

    override suspend fun profile(id: String): ProfileDetail =
        ProfileDetail(id, "", "", "off", false)

    override suspend fun addProfile(draft: ProfileDraft): ProfileSummary =
        ProfileSummary("new", draft.name, draft.dashboardURL, draft.externalMode, true)

    override suspend fun updateProfile(draft: ProfileDraft): ProfileSummary =
        ProfileSummary(draft.id ?: "new", draft.name, draft.dashboardURL, draft.externalMode, true)

    override suspend fun deleteProfile(id: String) = Unit

    override suspend fun setActiveProfile(id: String) = Unit

    override suspend fun settings(): AppSettings = settingsResult

    override suspend fun saveSettings(settings: AppSettings) {
        settingsResult = settings
    }

    override suspend fun changePassword(oldPassword: String, newPassword: String) = Unit

    override suspend fun exportVault(password: String): ByteArray = ByteArray(0)

    override suspend fun importVault(data: ByteArray, password: String) = Unit

    override fun navigationKind(raw: String): NavigationKind = NavigationKind.Blocked
}
