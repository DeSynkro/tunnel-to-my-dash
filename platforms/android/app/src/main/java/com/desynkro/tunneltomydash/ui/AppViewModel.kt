package com.desynkro.tunneltomydash.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.desynkro.tunneltomydash.data.AppSettings
import com.desynkro.tunneltomydash.data.ProfileSummary
import com.desynkro.tunneltomydash.data.VaultGateway
import com.desynkro.tunneltomydash.data.VaultStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface AppScreen {
    data object Initializing : AppScreen
    data object Setup : AppScreen
    data object Unlock : AppScreen
    data object Profiles : AppScreen
    data class EditProfile(val id: String?) : AppScreen
    data object Settings : AppScreen
}

data class AppUiState(
    val screen: AppScreen = AppScreen.Initializing,
    val vaultStatus: VaultStatus = VaultStatus(false, true, false),
    val profiles: List<ProfileSummary> = emptyList(),
    val settings: AppSettings = AppSettings(
        forceLANOnly = false,
        lockOnBackground = true,
        autoConnect = false,
        openPublicLinksInBrowser = false,
    ),
    val busy: Boolean = true,
    val error: String? = null,
)

class AppViewModel(private val gateway: VaultGateway) : ViewModel() {
    private val _state = MutableStateFlow(AppUiState())
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    init {
        bootstrap()
    }

    fun bootstrap() {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try {
                if (!gateway.hasVault()) {
                    _state.update {
                        it.copy(
                            screen = AppScreen.Setup,
                            vaultStatus = VaultStatus(false, true, false),
                            busy = false,
                        )
                    }
                    return@launch
                }
                val status = gateway.openVault()
                _state.update { it.copy(vaultStatus = status) }
                if (status.locked) {
                    _state.update { it.copy(screen = AppScreen.Unlock, busy = false) }
                } else {
                    enterProfiles()
                }
            } catch (caught: Throwable) {
                _state.update {
                    it.copy(
                        screen = if (gateway.hasVault()) AppScreen.Unlock else AppScreen.Setup,
                        busy = false,
                        error = caught.message ?: "Could not open the vault",
                    )
                }
            }
        }
    }

    fun createVault(password: String, usePassword: Boolean) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try {
                gateway.createVault(if (usePassword) password else "")
                enterProfiles()
            } catch (caught: Throwable) {
                _state.update {
                    it.copy(
                        screen = AppScreen.Setup,
                        busy = false,
                        error = caught.message ?: "Could not create the vault",
                    )
                }
            }
        }
    }

    fun unlock(password: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try {
                gateway.unlock(password)
                enterProfiles()
            } catch (caught: Throwable) {
                _state.update {
                    it.copy(
                        screen = AppScreen.Unlock,
                        busy = false,
                        error = caught.message ?: "Could not unlock the vault",
                    )
                }
            }
        }
    }

    fun lock() {
        gateway.lock()
        val status = runCatching { gateway.status() }.getOrElse {
            _state.value.vaultStatus.copy(locked = true)
        }
        _state.update {
            it.copy(
                vaultStatus = status,
                screen = if (status.passwordProtected) AppScreen.Unlock else AppScreen.Profiles,
                busy = false,
                error = null,
            )
        }
    }

    fun loadProfiles() {
        viewModelScope.launch {
            runCatching { gateway.profiles() }.onSuccess { profiles ->
                _state.update { it.copy(profiles = profiles) }
            }
        }
    }

    fun loadSettings() {
        viewModelScope.launch {
            runCatching { gateway.settings() }.onSuccess { settings ->
                _state.update { it.copy(settings = settings) }
            }
        }
    }

    fun openEditor(id: String?) {
        _state.update { it.copy(screen = AppScreen.EditProfile(id), error = null) }
    }

    fun openSettings() {
        _state.update { it.copy(screen = AppScreen.Settings, error = null) }
    }

    fun backToProfiles() {
        _state.update { it.copy(screen = AppScreen.Profiles, error = null) }
        loadProfiles()
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }

    private suspend fun enterProfiles() {
        val status = runCatching { gateway.status() }.getOrElse {
            _state.value.vaultStatus.copy(locked = false)
        }
        val profiles = runCatching { gateway.profiles() }.getOrDefault(emptyList())
        val settings = runCatching { gateway.settings() }.getOrDefault(_state.value.settings)
        _state.update {
            it.copy(
                screen = AppScreen.Profiles,
                vaultStatus = status,
                profiles = profiles,
                settings = settings,
                busy = false,
                error = null,
            )
        }
    }

    companion object {
        fun factory(gateway: VaultGateway): ViewModelProvider.Factory = viewModelFactory {
            initializer { AppViewModel(gateway) }
        }
    }
}
