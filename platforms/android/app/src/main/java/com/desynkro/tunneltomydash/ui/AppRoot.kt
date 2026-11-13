package com.desynkro.tunneltomydash.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
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
fun AppRoot(viewModel: AppViewModel) {
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
        AppScreen.Profiles -> ProfilesPlaceholder(state, viewModel)
        is AppScreen.EditProfile -> PlaceholderScreen(
            title = if (screen.id == null) "New profile" else "Edit profile",
            onBack = viewModel::backToProfiles,
        )
        AppScreen.Settings -> PlaceholderScreen(
            title = "Settings",
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

@Composable
private fun ProfilesPlaceholder(state: AppUiState, viewModel: AppViewModel) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Profiles", style = MaterialTheme.typography.headlineMedium)
        if (state.profiles.isEmpty()) {
            Text(
                "No profiles yet. Add a WireGuard .conf and a dashboard URL.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            state.profiles.forEach { profile ->
                Text(
                    if (profile.active) "${profile.name} (active)" else profile.name,
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    profile.dashboardURL,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Button(
            onClick = { viewModel.openEditor(null) },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Add profile")
        }
        OutlinedButton(
            onClick = { viewModel.openSettings() },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Settings")
        }
        if (state.vaultStatus.passwordProtected) {
            OutlinedButton(
                onClick = { viewModel.lock() },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Lock")
            }
        }
    }
}

@Composable
private fun PlaceholderScreen(title: String, onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, style = MaterialTheme.typography.headlineMedium)
        Text(
            "This screen is wired up in the next step.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = onBack) {
            Text("Back")
        }
    }
}
