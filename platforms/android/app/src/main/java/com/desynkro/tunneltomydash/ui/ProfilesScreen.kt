package com.desynkro.tunneltomydash.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.desynkro.tunneltomydash.data.ProfileSummary
import com.desynkro.tunneltomydash.service.ConnectionState

@Composable
fun ProfilesScreen(
    state: AppUiState,
    connectionState: ConnectionState,
    lostConnection: Boolean,
    onConnect: (String) -> Unit,
    onDisconnect: () -> Unit,
    onRetryLostConnection: () -> Unit,
    onAdd: () -> Unit,
    onEdit: (String) -> Unit,
    onSetActive: (String) -> Unit,
    onDelete: (String) -> Unit,
    onSettings: () -> Unit,
    onLock: () -> Unit,
) {
    var pendingDelete by remember { mutableStateOf<ProfileSummary?>(null) }
    val connectionActive =
        connectionState is ConnectionState.Connecting || connectionState is ConnectionState.Connected

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Dashboards", style = MaterialTheme.typography.headlineMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onSettings, enabled = !connectionActive) {
                Text("Settings")
            }
            if (state.vaultStatus.passwordProtected) {
                OutlinedButton(onClick = onLock) {
                    Text("Lock")
                }
            }
        }

        when (connectionState) {
            is ConnectionState.Connecting -> {
                val name = state.profiles
                    .firstOrNull { it.id == connectionState.profileID }
                    ?.name
                    ?: "the dashboard"
                OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Connecting to $name…", style = MaterialTheme.typography.titleMedium)
                        OutlinedButton(onClick = onDisconnect) {
                            Text("Cancel")
                        }
                    }
                }
            }
            is ConnectionState.Connected -> {
                OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "Connected to ${connectionState.info.profileName}",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        OutlinedButton(onClick = onDisconnect) {
                            Text("Stop")
                        }
                    }
                }
            }
            is ConnectionState.Error -> {
                OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "Connection failed",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            connectionState.message,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedButton(onClick = onDisconnect) {
                            Text("Clear")
                        }
                    }
                }
            }
            else -> {
                if (lostConnection) {
                    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "The previous connection was lost.",
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                "Reconnect to the last profile, or choose another one below.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Button(onClick = onRetryLostConnection) {
                                Text("Reconnect")
                            }
                        }
                    }
                }
            }
        }

        if (state.error != null) {
            Text(state.error, color = MaterialTheme.colorScheme.error)
        }
        if (state.profiles.isEmpty()) {
            Text(
                "No dashboards yet. Add one to start.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        state.profiles.forEach { profile ->
            OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(profile.name, style = MaterialTheme.typography.titleMedium)
                        if (profile.active) {
                            Text(
                                "Active",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                    Text(
                        profile.dashboardURL,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        when {
                            state.settings.forceLANOnly -> "LAN only (forced by settings)"
                            profile.externalMode == "off" -> "LAN only"
                            profile.externalMode == "origins" ->
                                "External content: specific origins"
                            else -> "External content: all"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { onConnect(profile.id) },
                            enabled = !connectionActive,
                        ) {
                            Text("Connect")
                        }
                        OutlinedButton(
                            onClick = { onEdit(profile.id) },
                            enabled = !connectionActive,
                        ) {
                            Text("Edit")
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (!profile.active) {
                            OutlinedButton(
                                onClick = { onSetActive(profile.id) },
                                enabled = !connectionActive,
                            ) {
                                Text("Set active")
                            }
                        }
                        TextButton(
                            onClick = { pendingDelete = profile },
                            enabled = !connectionActive,
                            colors = ButtonDefaults.textButtonColors(
                                contentColor = MaterialTheme.colorScheme.error,
                            ),
                        ) {
                            Text("Delete")
                        }
                    }
                }
            }
        }
        Button(
            onClick = onAdd,
            enabled = !connectionActive,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Add profile")
        }
    }

    pendingDelete?.let { profile ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Delete ${profile.name}?") },
            text = { Text("This removes the profile from the vault.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingDelete = null
                        onDelete(profile.id)
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) {
                    Text("Cancel")
                }
            },
        )
    }
}
