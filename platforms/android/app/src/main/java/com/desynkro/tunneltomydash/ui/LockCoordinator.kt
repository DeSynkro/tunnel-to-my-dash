package com.desynkro.tunneltomydash.ui

import com.desynkro.tunneltomydash.data.AppSettings
import com.desynkro.tunneltomydash.data.VaultStatus

class LockCoordinator {
    private var externalActivities = 0

    fun enterExternalActivity() {
        externalActivities++
    }

    fun leaveExternalActivity() {
        if (externalActivities > 0) {
            externalActivities--
        }
    }

    fun shouldLock(vaultStatus: VaultStatus, settings: AppSettings): Boolean =
        externalActivities == 0 &&
            settings.lockOnBackground &&
            vaultStatus.passwordProtected &&
            !vaultStatus.locked
}
