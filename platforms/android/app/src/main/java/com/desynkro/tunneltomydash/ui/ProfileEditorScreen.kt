package com.desynkro.tunneltomydash.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.desynkro.tunneltomydash.data.ProfileDetail
import com.desynkro.tunneltomydash.data.ProfileDraft
import com.desynkro.tunneltomydash.data.looksLikeWireGuardConfig
import com.desynkro.tunneltomydash.data.resolveExternalMode
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

private const val QR_NOTICE_SEEN = "qr_camera_notice_seen"

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
    var showQrNotice by remember { mutableStateOf(false) }
    val qrNoticePrefs = remember {
        context.getSharedPreferences("ui", Context.MODE_PRIVATE)
    }

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

    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        onExternalActivityEnd()
        val contents = result.contents ?: return@rememberLauncherForActivityResult
        if (looksLikeWireGuardConfig(contents)) {
            tunnelConfig = contents.trim()
            hasConfig = true
            localError = null
        } else {
            localError = "That QR code is not a WireGuard config."
        }
    }

    val launchScanner = {
        onExternalActivityStart()
        scanner.launch(
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Scan a WireGuard QR code")
                .setBeepEnabled(false)
                .setBarcodeImageEnabled(false)
                .setOrientationLocked(false),
        )
    }

    val cameraPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        onExternalActivityEnd()
        if (granted) {
            launchScanner()
        } else {
            localError = "Camera access is needed to scan a QR code. " +
                "You can still choose a .conf file."
        }
    }

    val requestScanner = {
        if (
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            launchScanner()
        } else {
            onExternalActivityStart()
            cameraPermission.launch(Manifest.permission.CAMERA)
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
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = {
                    if (qrNoticePrefs.getBoolean(QR_NOTICE_SEEN, false)) {
                        requestScanner()
                    } else {
                        showQrNotice = true
                    }
                },
                enabled = !busy,
            ) {
                Text("Scan QR")
            }
            OutlinedButton(
                onClick = {
                    onExternalActivityStart()
                    picker.launch(arrayOf("*/*"))
                },
                enabled = !busy,
            ) {
                Text(if (hasConfig) "Replace .conf" else "Choose .conf")
            }
        }
        Text(
            "The camera is used only to scan a WireGuard QR code.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
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
                    localError = "Choose or scan a WireGuard config first"
                    return@Button
                }
                localError = null
                val externalMode = resolveExternalMode(
                    allowExternal,
                    storedExternalMode,
                    storedOrigins,
                )
                onSave(
                    ProfileDraft(
                        id = detail?.id,
                        name = name.trim(),
                        tunnelConfig = tunnelConfig.trim(),
                        dashboardURL = dashboardURL.trim(),
                        externalMode = externalMode,
                        externalOrigins = storedOrigins,
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

    if (showQrNotice) {
        AlertDialog(
            onDismissRequest = { showQrNotice = false },
            title = { Text("Scan a WireGuard QR code") },
            text = {
                Text(
                    "Camera access is only used to scan a WireGuard QR code. " +
                        "Nothing is recorded or uploaded.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        qrNoticePrefs.edit().putBoolean(QR_NOTICE_SEEN, true).apply()
                        showQrNotice = false
                        requestScanner()
                    },
                ) {
                    Text("Continue")
                }
            },
            dismissButton = {
                TextButton(onClick = { showQrNotice = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}
