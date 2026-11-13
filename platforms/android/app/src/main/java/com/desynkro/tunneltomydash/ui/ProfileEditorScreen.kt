package com.desynkro.tunneltomydash.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.desynkro.tunneltomydash.data.ProfileDetail
import com.desynkro.tunneltomydash.data.ProfileDraft
import com.desynkro.tunneltomydash.data.resolveExternalMode

@Composable
fun ProfileEditorScreen(
    detail: ProfileDetail?,
    busy: Boolean,
    error: String?,
    forceLANOnly: Boolean,
    onSave: (ProfileDraft) -> Unit,
    onBack: () -> Unit,
    onExternalActivityStart: () -> Unit = {},
    onExternalActivityEnd: () -> Unit = {},
) {
    val context = LocalContext.current
    var name by remember(detail?.id) { mutableStateOf(detail?.name ?: "") }
    var dashboardURL by remember(detail?.id) { mutableStateOf(detail?.dashboardURL ?: "") }
    var allowExternal by remember(detail?.id) {
        mutableStateOf(detail?.externalMode.orEmpty().ifEmpty { "off" } != "off")
    }
    val storedExternalMode = detail?.externalMode.orEmpty().ifEmpty { "off" }
    val storedOrigins = detail?.externalOrigins.orEmpty()
    var tunnelConfig by remember(detail?.id) { mutableStateOf("") }
    var hasConfig by remember(detail?.id) { mutableStateOf(detail?.hasTunnelConfig == true) }
    var localError by remember(detail?.id) { mutableStateOf<String?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        onExternalActivityEnd()
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }
        runCatching {
            context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                ?: error("The selected file could not be opened")
        }.onSuccess { text ->
            tunnelConfig = text
            hasConfig = true
            localError = null
        }.onFailure { caught ->
            localError = "Could not read the config: ${caught.message}"
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            if (detail == null) "New profile" else "Edit profile",
            style = MaterialTheme.typography.headlineMedium,
        )
        OutlinedTextField(
            value = name,
            onValueChange = {
                name = it
                localError = null
            },
            label = { Text("Profile name") },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = dashboardURL,
            onValueChange = {
                dashboardURL = it
                localError = null
            },
            label = { Text("Dashboard URL") },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Switch(
                checked = allowExternal,
                onCheckedChange = { allowExternal = it },
                enabled = !busy && !forceLANOnly,
            )
            Text("Allow external content")
        }
        if (forceLANOnly) {
            Text(
                "Force LAN-only is on, so external content is disabled for every profile.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else if (allowExternal && storedExternalMode == "origins") {
            Text(
                "This profile allows only the specific public origins saved in the vault. " +
                    "Use the desktop app to change that list.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Text(
            if (hasConfig) "WireGuard config loaded" else "No WireGuard config selected",
            style = MaterialTheme.typography.bodyMedium,
        )
        OutlinedButton(
            onClick = {
                onExternalActivityStart()
                picker.launch(arrayOf("*/*"))
            },
            enabled = !busy,
        ) {
            Text(if (hasConfig) "Replace .conf" else "Choose .conf")
        }
        if (detail != null && hasConfig && tunnelConfig.isBlank()) {
            Text(
                "Leave this unchanged to keep the stored config.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        val message = localError ?: error
        if (message != null) {
            Text(message, color = MaterialTheme.colorScheme.error)
        }

        Button(
            onClick = {
                if (name.isBlank()) {
                    localError = "Enter a profile name"
                    return@Button
                }
                if (dashboardURL.isBlank()) {
                    localError = "Enter a dashboard URL"
                    return@Button
                }
                if (detail == null && tunnelConfig.isBlank()) {
                    localError = "Choose a WireGuard .conf first"
                    return@Button
                }
                localError = null
                val externalMode = resolveExternalMode(allowExternal, storedExternalMode)
                onSave(
                    ProfileDraft(
                        id = detail?.id,
                        name = name.trim(),
                        tunnelConfig = tunnelConfig.trim(),
                        dashboardURL = dashboardURL.trim(),
                        externalMode = externalMode,
                        externalOrigins = if (externalMode == "origins") storedOrigins else emptyList(),
                    ),
                )
            },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (busy) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
            } else {
                Text("Save profile")
            }
        }
        OutlinedButton(
            onClick = onBack,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Cancel")
        }
    }
}
