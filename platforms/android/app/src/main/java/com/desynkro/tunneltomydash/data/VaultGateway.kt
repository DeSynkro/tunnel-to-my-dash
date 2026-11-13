package com.desynkro.tunneltomydash.data

interface VaultGateway {
    fun hasVault(): Boolean
    suspend fun createVault(password: String): VaultStatus
    suspend fun openVault(): VaultStatus
    suspend fun unlock(password: String)
    suspend fun lock()
    suspend fun status(): VaultStatus

    suspend fun profiles(): List<ProfileSummary>
    suspend fun profile(id: String): ProfileDetail
    suspend fun addProfile(draft: ProfileDraft): ProfileSummary
    suspend fun updateProfile(draft: ProfileDraft): ProfileSummary
    suspend fun deleteProfile(id: String)
    suspend fun setActiveProfile(id: String)

    suspend fun settings(): AppSettings
    suspend fun saveSettings(settings: AppSettings)
    suspend fun changePassword(oldPassword: String, newPassword: String)
    suspend fun verifyPassword(password: String)

    suspend fun exportVault(password: String): ByteArray
    suspend fun importVault(data: ByteArray, password: String)

    fun navigationKind(raw: String): NavigationKind
}
