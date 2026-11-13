package com.desynkro.tunneltomydash.ui

import android.net.Uri
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.desynkro.tunneltomydash.data.AppSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(
    state: AppUiState,
    onSaveSettings: (AppSettings) -> Unit,
    onChangePassword: suspend (String, String) -> Unit,
    onExport: suspend (String) -> ByteArray,
    onImport: suspend (ByteArray, String) -> Unit,
    onBack: () -> Unit,
    onExternalActivityStart: () -> Unit = {},
    onExternalActivityEnd: () -> Unit = {},
    biometricAvailable: Boolean = false,
    biometricEnabled: Boolean = false,
    onEnableBiometrics: suspend (String) -> Boolean = { false },
    onDisableBiometrics: () -> Unit = {},
    connectionActive: Boolean = false,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var messageIsError by remember { mutableStateOf(false) }
    var showChangePassword by remember { mutableStateOf(false) }
    var showSetPassword by remember { mutableStateOf(false) }
    var showEnableBiometric by remember { mutableStateOf(false) }
    var pendingExportUri by remember { mutableStateOf<Uri?>(null) }
    var pendingImportData by remember { mutableStateOf<ByteArray?>(null) }

    fun report(text: String, isError: Boolean) {
        message = text
        messageIsError = isError
    }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream"),
    ) { uri ->
        onExternalActivityEnd()
        if (uri != null) {
            pendingExportUri = uri
        }
    }
    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        onExternalActivityEnd()
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }
        scope.launch {
            busy = true
            try {
                val bytes = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                }
                if (bytes == null) {
                    report("Could not read the selected backup", true)
                } else {
                    pendingImportData = bytes
                }
            } catch (caught: Throwable) {
                report(caught.message ?: "Could not read the selected backup", true)
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium)
        if (connectionActive) {
            Text(
                "Stop the tunnel before changing settings.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        SettingSwitch(
            label = "Force LAN-only",
            checked = state.settings.forceLANOnly,
            enabled = !busy && !connectionActive,
            onCheckedChange = {
                onSaveSettings(state.settings.copy(forceLANOnly = it))
            },
        )
        Text(
            "Overrides per-profile external content.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (state.vaultStatus.passwordProtected) {
            SettingSwitch(
                label = "Lock when the app is backgrounded",
                checked = state.settings.lockOnBackground,
                enabled = !busy && !connectionActive,
                onCheckedChange = {
                    onSaveSettings(state.settings.copy(lockOnBackground = it))
                },
            )
            Text(
                "Locks the vault when you switch apps, lock the screen, or the screen turns off.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (biometricAvailable) {
                SettingSwitch(
                    label = "Fingerprint unlock",
                    checked = biometricEnabled,
                    enabled = !busy && !connectionActive,
                    onCheckedChange = { enable ->
                        if (enable) {
                            showEnableBiometric = true
                        } else {
                            onDisableBiometrics()
                        }
                    },
                )
            }
        } else {
            Text(
                "Set a vault password to enable lock-on-background.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(
                onClick = { showSetPassword = true },
                enabled = !busy && !connectionActive,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Set vault password")
            }
        }

        SettingSwitch(
            label = "Connect automatically on launch",
            checked = state.settings.autoConnect,
            enabled = !busy && !connectionActive,
            onCheckedChange = {
                onSaveSettings(state.settings.copy(autoConnect = it))
            },
        )
        SettingSwitch(
            label = "Open public links in the system browser",
            checked = state.settings.openPublicLinksInBrowser,
            enabled = !busy && !connectionActive,
            onCheckedChange = {
                onSaveSettings(state.settings.copy(openPublicLinksInBrowser = it))
            },
        )
        Text(
            "LAN links stay in the dashboard. When this is off, public links are blocked.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (state.vaultStatus.passwordProtected) {
            OutlinedButton(
                onClick = { showChangePassword = true },
                enabled = !busy && !connectionActive,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Change vault password")
            }
        }
        OutlinedButton(
            onClick = {
                onExternalActivityStart()
                exportLauncher.launch("tunnel-to-my-dash-backup.ttmd")
            },
            enabled = !busy && !connectionActive,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Export vault")
        }
        OutlinedButton(
            onClick = {
                onExternalActivityStart()
                importLauncher.launch(arrayOf("application/octet-stream", "*/*"))
            },
            enabled = !busy && !connectionActive,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Import vault")
        }

        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        }
        val text = message ?: state.error
        if (text != null) {
            Text(
                text,
                color = if (messageIsError || state.error != null) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.primary
                },
            )
        }

        OutlinedButton(
            onClick = onBack,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Back")
        }
    }

    if (showEnableBiometric) {
        PasswordDialog(
            title = "Confirm vault password",
            confirmLabel = "Enable",
            onDismiss = { showEnableBiometric = false },
            onConfirm = { password ->
                showEnableBiometric = false
                scope.launch {
                    busy = true
                    try {
                        if (onEnableBiometrics(password)) {
                            report("Fingerprint unlock enabled", false)
                        } else {
                            report("Fingerprint unlock was not enabled", true)
                        }
                    } catch (caught: Throwable) {
                        report(
                            caught.message ?: "Could not enable fingerprint unlock",
                            true,
                        )
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }

    if (showSetPassword) {
        ChangePasswordDialog(
            onDismiss = { showSetPassword = false },
            onConfirm = { _, newPassword ->
                showSetPassword = false
                scope.launch {
                    busy = true
                    try {
                        onChangePassword("", newPassword)
                        report("Vault password set", false)
                    } catch (caught: Throwable) {
                        report(caught.message ?: "Could not set the password", true)
                    } finally {
                        busy = false
                    }
                }
            },
            showCurrentPassword = false,
        )
    }

    if (showChangePassword) {
        ChangePasswordDialog(
            onDismiss = { showChangePassword = false },
            onConfirm = { oldPassword, newPassword ->
                showChangePassword = false
                scope.launch {
                    busy = true
                    try {
                        onChangePassword(oldPassword, newPassword)
                        report("Vault password changed", false)
                    } catch (caught: Throwable) {
                        report(caught.message ?: "Could not change the password", true)
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }

    pendingExportUri?.let { uri ->
        PasswordDialog(
            title = "Password for the export",
            confirmLabel = "Export",
            onDismiss = {
                pendingExportUri = null
                scope.launch {
                    withContext(Dispatchers.IO) {
                        runCatching { context.contentResolver.delete(uri, null, null) }
                    }
                }
            },
            onConfirm = { password ->
                pendingExportUri = null
                scope.launch {
                    busy = true
                    try {
                        val bytes = onExport(password)
                        withContext(Dispatchers.IO) {
                            context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                                ?: error("Could not open the selected file")
                        }
                        report("Vault exported", false)
                    } catch (caught: Throwable) {
                        report(caught.message ?: "Could not export the vault", true)
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }

    pendingImportData?.let { data ->
        PasswordDialog(
            title = "Password for the backup",
            confirmLabel = "Import",
            onDismiss = { pendingImportData = null },
            onConfirm = { password ->
                pendingImportData = null
                scope.launch {
                    busy = true
                    try {
                        onImport(data, password)
                        report("Vault imported", false)
                    } catch (caught: Throwable) {
                        report(caught.message ?: "Could not import the vault", true)
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
}

@Composable
private fun SettingSwitch(
    label: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            enabled = enabled,
        )
        Text(label)
    }
}
