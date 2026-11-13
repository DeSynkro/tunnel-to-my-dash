package com.desynkro.tunneltomydash.ui

import com.desynkro.tunneltomydash.data.AppSettings
import com.desynkro.tunneltomydash.data.ProfileSummary
import com.desynkro.tunneltomydash.data.VaultStatus
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class SettingsViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    @Test
    fun saveSettingsUpdatesStateAndGateway() {
        val fake = FakeVaultGateway()
        val viewModel = settingsViewModel(fake)
        val settings = AppSettings(
            forceLANOnly = true,
            lockOnBackground = false,
            autoConnect = true,
            openPublicLinksInBrowser = true,
        )

        viewModel.saveSettings(settings)

        assertEquals(settings, viewModel.state.value.settings)
        assertEquals(settings, fake.settingsResult)
    }

    @Test
    fun changePasswordCallsGateway() = runTest {
        val fake = FakeVaultGateway()
        val viewModel = settingsViewModel(fake)

        viewModel.changePassword("old password", "new password")

        assertEquals("old password" to "new password", fake.lastChangedPassword)
    }

    @Test
    fun exportVaultReturnsBytes() = runTest {
        val fake = FakeVaultGateway(exportResult = byteArrayOf(1, 2, 3))
        val viewModel = settingsViewModel(fake)

        val exported = viewModel.exportVault("backup password")

        assertArrayEquals(byteArrayOf(1, 2, 3), exported)
        assertEquals("backup password", fake.lastExportedPassword)
    }

    @Test
    fun importVaultRefreshesProfilesAndSettings() = runTest {
        val fake = FakeVaultGateway(
            profilesResult = listOf(
                ProfileSummary("home", "Home", "http://192.168.0.3:3000", "off", true),
            ),
            settingsResult = AppSettings(true, false, true, true),
        )
        val viewModel = settingsViewModel(fake)

        viewModel.importVault(byteArrayOf(9), "backup password")

        assertEquals(1, viewModel.state.value.profiles.size)
        assertEquals("backup password", fake.lastImportedPassword)
        assertTrue(viewModel.state.value.settings.forceLANOnly)
    }

    @Test
    fun importErrorPropagates() = runTest {
        val fake = FakeVaultGateway(importError = IllegalStateException("wrong password"))
        val viewModel = settingsViewModel(fake)

        val result = runCatching {
            viewModel.importVault(byteArrayOf(9), "wrong")
        }

        assertTrue(result.isFailure)
    }

    private fun settingsViewModel(fake: FakeVaultGateway): AppViewModel {
        fake.hasVaultResult = true
        fake.openResult = VaultStatus(true, false, false)
        fake.statusResult = VaultStatus(true, false, false)
        return AppViewModel(fake)
    }
}
