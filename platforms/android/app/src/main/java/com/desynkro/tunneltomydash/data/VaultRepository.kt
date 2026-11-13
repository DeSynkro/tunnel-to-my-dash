package com.desynkro.tunneltomydash.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import mobile.Mobile

class VaultRepository(private val vaultPath: String) : VaultGateway {
    override fun hasVault(): Boolean = Mobile.vaultExists(vaultPath)

    override suspend fun createVault(password: String): VaultStatus = withContext(Dispatchers.IO) {
        Mobile.createVault(vaultPath, password)
        parseVaultStatus(Mobile.vaultStatusJSON())
    }

    override suspend fun openVault(): VaultStatus = withContext(Dispatchers.IO) {
        Mobile.openVault(vaultPath)
        parseVaultStatus(Mobile.vaultStatusJSON())
    }

    override suspend fun unlock(password: String) = withContext(Dispatchers.IO) {
        Mobile.unlockVault(password)
    }

    override suspend fun lock() = withContext(Dispatchers.IO) {
        Mobile.lockVault()
    }

    override suspend fun status(): VaultStatus = withContext(Dispatchers.IO) {
        parseVaultStatus(Mobile.vaultStatusJSON())
    }

    override suspend fun profiles(): List<ProfileSummary> = withContext(Dispatchers.IO) {
        parseProfiles(Mobile.profilesJSON())
    }

    override suspend fun profile(id: String): ProfileDetail = withContext(Dispatchers.IO) {
        parseProfileDetail(Mobile.profileJSON(id))
    }

    override suspend fun addProfile(draft: ProfileDraft): ProfileSummary = withContext(Dispatchers.IO) {
        parseProfileSummary(Mobile.addProfileJSON(draft.toJson()))
    }

    override suspend fun updateProfile(draft: ProfileDraft): ProfileSummary = withContext(Dispatchers.IO) {
        requireNotNull(draft.id) { "a profile id is required to update a profile" }
        parseProfileSummary(Mobile.updateProfileJSON(draft.toJson()))
    }

    override suspend fun deleteProfile(id: String) = withContext(Dispatchers.IO) {
        Mobile.deleteProfile(id)
    }

    override suspend fun setActiveProfile(id: String) = withContext(Dispatchers.IO) {
        Mobile.setActiveProfile(id)
    }

    override suspend fun settings(): AppSettings = withContext(Dispatchers.IO) {
        parseSettings(Mobile.settingsJSON())
    }

    override suspend fun saveSettings(settings: AppSettings) = withContext(Dispatchers.IO) {
        Mobile.setSettingsJSON(settings.toJson())
    }

    override suspend fun changePassword(oldPassword: String, newPassword: String) =
        withContext(Dispatchers.IO) {
            Mobile.changeVaultPassword(oldPassword, newPassword)
        }

    override suspend fun verifyPassword(password: String) = withContext(Dispatchers.IO) {
        Mobile.verifyVaultPassword(password)
    }

    override suspend fun exportVault(password: String): ByteArray = withContext(Dispatchers.IO) {
        Mobile.exportVault(password)
    }

    override suspend fun importVault(data: ByteArray, password: String) = withContext(Dispatchers.IO) {
        Mobile.importVault(data, password)
    }

    override fun navigationKind(raw: String): NavigationKind =
        parseNavigationKind(Mobile.navigationKind(raw))
}
