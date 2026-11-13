package com.desynkro.tunneltomydash.ui

import com.desynkro.tunneltomydash.data.AppSettings
import com.desynkro.tunneltomydash.data.VaultStatus
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LockCoordinatorTest {
    private val settings = AppSettings(
        forceLANOnly = false,
        lockOnBackground = true,
        autoConnect = false,
        openPublicLinksInBrowser = false,
    )
    private val unlockedPassword = VaultStatus(
        hasVault = true,
        locked = false,
        passwordProtected = true,
    )

    @Test
    fun locksPasswordVaultWhenBackgrounded() {
        val coordinator = LockCoordinator()
        assertTrue(coordinator.shouldLock(unlockedPassword, settings))
    }

    @Test
    fun keyfileVaultNeverLocks() {
        val coordinator = LockCoordinator()
        val keyfile = unlockedPassword.copy(passwordProtected = false)
        assertFalse(coordinator.shouldLock(keyfile, settings))
    }

    @Test
    fun alreadyLockedVaultDoesNotLockAgain() {
        val coordinator = LockCoordinator()
        assertFalse(coordinator.shouldLock(unlockedPassword.copy(locked = true), settings))
    }

    @Test
    fun settingOffSkipsLock() {
        val coordinator = LockCoordinator()
        assertFalse(
            coordinator.shouldLock(
                unlockedPassword,
                settings.copy(lockOnBackground = false),
            ),
        )
    }

    @Test
    fun externalActivitySuppressesLock() {
        val coordinator = LockCoordinator()
        coordinator.enterExternalActivity()
        assertFalse(coordinator.shouldLock(unlockedPassword, settings))

        coordinator.leaveExternalActivity()
        assertTrue(coordinator.shouldLock(unlockedPassword, settings))
    }
}
