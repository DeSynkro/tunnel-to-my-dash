package com.desynkro.tunneltomydash.ui

import com.desynkro.tunneltomydash.data.AppSettings
import com.desynkro.tunneltomydash.data.NavigationKind
import com.desynkro.tunneltomydash.data.ProfileDetail
import com.desynkro.tunneltomydash.data.ProfileDraft
import com.desynkro.tunneltomydash.data.ProfileSummary
import com.desynkro.tunneltomydash.data.VaultGateway
import com.desynkro.tunneltomydash.data.VaultStatus

internal class FakeVaultGateway(
    var hasVaultResult: Boolean = false,
    var openResult: VaultStatus = VaultStatus(true, false, false),
    var createResult: VaultStatus = VaultStatus(true, false, false),
    var unlockError: Throwable? = null,
    var profilesResult: List<ProfileSummary> = emptyList(),
    var settingsResult: AppSettings = AppSettings(false, true, false, false),
    var statusResult: VaultStatus = VaultStatus(true, false, false),
    var profileResult: ProfileDetail? = null,
    var profileError: Throwable? = null,
    var addError: Throwable? = null,
    var updateError: Throwable? = null,
    var deleteError: Throwable? = null,
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

    override suspend fun profile(id: String): ProfileDetail {
        profileError?.let { throw it }
        profileResult?.takeIf { it.id == id }?.let { return it }
        val summary = profilesResult.firstOrNull { it.id == id }
            ?: error("profile $id not found")
        return ProfileDetail(
            id = summary.id,
            name = summary.name,
            dashboardURL = summary.dashboardURL,
            externalMode = summary.externalMode,
            hasTunnelConfig = true,
        )
    }

    override suspend fun addProfile(draft: ProfileDraft): ProfileSummary {
        addError?.let { throw it }
        val summary = ProfileSummary(
            id = "new-${profilesResult.size + 1}",
            name = draft.name,
            dashboardURL = draft.dashboardURL,
            externalMode = draft.externalMode,
            active = profilesResult.isEmpty(),
        )
        profilesResult = profilesResult + summary
        return summary
    }

    override suspend fun updateProfile(draft: ProfileDraft): ProfileSummary {
        updateError?.let { throw it }
        val id = draft.id ?: error("a profile id is required")
        profilesResult = profilesResult.map { profile ->
            if (profile.id == id) {
                profile.copy(
                    name = draft.name,
                    dashboardURL = draft.dashboardURL,
                    externalMode = draft.externalMode,
                )
            } else {
                profile
            }
        }
        return profilesResult.first { it.id == id }
    }

    override suspend fun deleteProfile(id: String) {
        deleteError?.let { throw it }
        profilesResult = profilesResult.filterNot { it.id == id }
    }

    override suspend fun setActiveProfile(id: String) {
        profilesResult = profilesResult.map { it.copy(active = it.id == id) }
    }

    override suspend fun settings(): AppSettings = settingsResult

    override suspend fun saveSettings(settings: AppSettings) {
        settingsResult = settings
    }

    override suspend fun changePassword(oldPassword: String, newPassword: String) = Unit

    override suspend fun exportVault(password: String): ByteArray = ByteArray(0)

    override suspend fun importVault(data: ByteArray, password: String) = Unit

    override fun navigationKind(raw: String): NavigationKind = NavigationKind.Blocked
}
