package com.desynkro.tunneltomydash.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.desynkro.tunneltomydash.service.ConnectionState

@Composable
fun AppRoot(
    viewModel: AppViewModel,
    onConnect: (String) -> Unit = {},
    onDisconnect: () -> Unit = {},
    onRetryLostConnection: () -> Unit = {},
    connectionState: ConnectionState = ConnectionState.Stopped,
    lostConnection: Boolean = false,
    onExternalActivityStart: () -> Unit = {},
    onExternalActivityEnd: () -> Unit = {},
    biometricAvailable: Boolean = false,
    biometricEnabled: Boolean = false,
    onEnableBiometrics: suspend (String) -> Boolean = { false },
    onDisableBiometrics: () -> Unit = {},
    onBiometricUnlock: () -> Unit = {},
    onChangePassword: suspend (String, String) -> Unit = viewModel::changePassword,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val connectionActive =
        connectionState is ConnectionState.Connecting || connectionState is ConnectionState.Connected

    when (val screen = state.screen) {
        AppScreen.Initializing -> LoadingScreen()
        AppScreen.Setup -> SetupScreen(
            busy = state.busy,
            error = state.error,
            onCreate = viewModel::createVault,
        )
        AppScreen.Unlock -> UnlockScreen(
            busy = state.busy,
            error = state.error,
            onUnlock = viewModel::unlock,
            biometricAvailable = biometricAvailable,
            biometricEnabled = biometricEnabled,
            onBiometricUnlock = onBiometricUnlock,
        )
        AppScreen.Profiles -> ProfilesScreen(
            state = state,
            connectionState = connectionState,
            lostConnection = lostConnection,
            onConnect = onConnect,
            onDisconnect = onDisconnect,
            onRetryLostConnection = onRetryLostConnection,
            onAdd = { viewModel.openEditor(null) },
            onEdit = { viewModel.openEditor(it) },
            onSetActive = viewModel::setActiveProfile,
            onDelete = viewModel::deleteProfile,
            onSettings = viewModel::openSettings,
            onLock = viewModel::lock,
        )
        is AppScreen.EditProfile -> {
            if (screen.id != null && state.editingProfile == null) {
                if (state.busy) {
                    LoadingScreen()
                } else {
                    ProfileLoadErrorScreen(
                        message = state.error,
                        onBack = viewModel::backToProfiles,
                    )
                }
            } else {
                ProfileEditorScreen(
                    detail = state.editingProfile,
                    busy = state.busy,
                    error = state.error,
                    forceLANOnly = state.settings.forceLANOnly,
                    onSave = viewModel::saveProfile,
                    onBack = viewModel::backToProfiles,
                    onExternalActivityStart = onExternalActivityStart,
                    onExternalActivityEnd = onExternalActivityEnd,
                )
            }
        }
        AppScreen.Settings -> SettingsScreen(
            state = state,
            onSaveSettings = viewModel::saveSettings,
            onChangePassword = onChangePassword,
            onExport = viewModel::exportVault,
            onImport = viewModel::importVault,
            onBack = viewModel::backToProfiles,
            onExternalActivityStart = onExternalActivityStart,
            onExternalActivityEnd = onExternalActivityEnd,
            biometricAvailable = biometricAvailable,
            biometricEnabled = biometricEnabled,
            onEnableBiometrics = onEnableBiometrics,
            onDisableBiometrics = onDisableBiometrics,
            connectionActive = connectionActive,
        )
    }
}

@Composable
private fun LoadingScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun ProfileLoadErrorScreen(message: String?, onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Could not load the profile", style = MaterialTheme.typography.headlineMedium)
        Text(
            message ?: "The profile could not be read from the vault.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = onBack) {
            Text("Back")
        }
    }
}
