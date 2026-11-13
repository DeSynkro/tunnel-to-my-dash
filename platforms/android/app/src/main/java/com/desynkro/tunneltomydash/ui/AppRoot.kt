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

@Composable
fun AppRoot(viewModel: AppViewModel, onConnect: (String) -> Unit = {}) {
    val state by viewModel.state.collectAsStateWithLifecycle()

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
        )
        AppScreen.Profiles -> ProfilesScreen(
            state = state,
            onConnect = onConnect,
            onAdd = { viewModel.openEditor(null) },
            onEdit = { viewModel.openEditor(it) },
            onSetActive = viewModel::setActiveProfile,
            onDelete = viewModel::deleteProfile,
            onSettings = viewModel::openSettings,
            onLock = viewModel::lock,
        )
        is AppScreen.EditProfile -> {
            if (screen.id != null && state.busy && state.editingProfile == null) {
                LoadingScreen()
            } else {
                ProfileEditorScreen(
                    detail = state.editingProfile,
                    busy = state.busy,
                    error = state.error,
                    forceLANOnly = state.settings.forceLANOnly,
                    onSave = viewModel::saveProfile,
                    onBack = viewModel::backToProfiles,
                )
            }
        }
        AppScreen.Settings -> SettingsScreen(
            state = state,
            onSaveSettings = viewModel::saveSettings,
            onChangePassword = viewModel::changePassword,
            onExport = viewModel::exportVault,
            onImport = viewModel::importVault,
            onBack = viewModel::backToProfiles,
        )
    }
}

@Composable
private fun LoadingScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}
