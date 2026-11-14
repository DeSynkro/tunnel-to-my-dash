package com.desynkro.tunneltomydash.ui

import androidx.lifecycle.viewModelScope
import com.desynkro.tunneltomydash.data.AppSettings
import com.desynkro.tunneltomydash.data.NavigationKind
import com.desynkro.tunneltomydash.data.ProfileDetail
import com.desynkro.tunneltomydash.data.ProfileDraft
import com.desynkro.tunneltomydash.data.ProfileSummary
import com.desynkro.tunneltomydash.data.VaultGateway
import com.desynkro.tunneltomydash.data.VaultStatus
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        val profile = ProfileSummary("home", "Home", "http://192.168.1.10:8080", "off", true)
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
    fun lockCompletesWhenViewModelScopeIsCancelled() = runTest {
        val fake = FakeVaultGateway(
            hasVaultResult = true,
            openResult = VaultStatus(true, false, true),
            statusResult = VaultStatus(true, false, true),
        )
        val viewModel = AppViewModel(fake, this)
        viewModel.viewModelScope.cancel()

        viewModel.lock()
        advanceUntilIdle()

        assertEquals(AppScreen.Unlock, viewModel.state.value.screen)
        assertTrue(viewModel.state.value.vaultStatus.locked)
    }

    @Test
    fun lockingKeyfileVaultDoesNothing() {
        val fake = FakeVaultGateway(
            hasVaultResult = true,
            openResult = VaultStatus(true, false, false),
            statusResult = VaultStatus(true, false, false),
        )
        val viewModel = AppViewModel(fake)
        assertEquals(AppScreen.Profiles, viewModel.state.value.screen)

        viewModel.lock()

        assertEquals(AppScreen.Profiles, viewModel.state.value.screen)
        assertFalse(viewModel.state.value.vaultStatus.locked)
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
