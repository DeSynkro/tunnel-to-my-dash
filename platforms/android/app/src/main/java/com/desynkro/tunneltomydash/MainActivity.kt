package com.desynkro.tunneltomydash

import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebChromeClient.CustomViewCallback
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import mobile.Mobile
import java.net.URI

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var fullscreenView: View? = null
    private var fullscreenCallback: CustomViewCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = WebViewClient()
            webChromeClient = object : WebChromeClient() {
                override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                    if (fullscreenView != null) {
                        callback.onCustomViewHidden()
                        return
                    }
                    fullscreenView = view
                    fullscreenCallback = callback
                    (window.decorView as ViewGroup).addView(
                        view,
                        ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        ),
                    )
                    WindowInsetsControllerCompat(window, view).hide(
                        WindowInsetsCompat.Type.systemBars(),
                    )
                }

                override fun onHideCustomView() {
                    hideFullscreen()
                }
            }
        }

        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                AppScreen()
            }
        }
    }

    private fun hideFullscreen() {
        val view = fullscreenView ?: return
        (window.decorView as ViewGroup).removeView(view)
        fullscreenView = null
        WindowInsetsControllerCompat(window, window.decorView).show(
            WindowInsetsCompat.Type.systemBars(),
        )
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
    }

    private fun clearProxy() {
        runCatching {
            ProxyController.getInstance().clearProxyOverride(
                ContextCompat.getMainExecutor(this),
            ) {}
        }
    }

    @Composable
    private fun AppScreen() {
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        var configText by remember { mutableStateOf("") }
        var configName by remember { mutableStateOf<String?>(null) }
        var dashboardUrl by remember { mutableStateOf("http://192.168.0.3:3000") }
        var connected by remember { mutableStateOf(false) }
        var busy by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }

        val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri == null) {
                return@rememberLauncherForActivityResult
            }
            try {
                context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { reader ->
                    configText = reader.readText()
                    configName = uri.lastPathSegment ?: "WireGuard config"
                    error = null
                }
            } catch (caught: Exception) {
                error = "Could not read the config: ${caught.message}"
            }
        }

        fun disconnect() {
            runCatching { webView.stopLoading() }
            runCatching { webView.loadUrl("about:blank") }
            clearProxy()
            scope.launch(Dispatchers.IO) { runCatching { Mobile.stop() } }
            connected = false
            busy = false
        }

        if (connected) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(androidx.compose.ui.graphics.Color.Black),
            ) {
                AndroidView(
                    factory = { webView },
                    modifier = Modifier.fillMaxSize(),
                )
                Button(
                    onClick = { disconnect() },
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(12.dp),
                ) {
                    Text("Stop")
                }
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Tunnel to My Dash", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "Android spike. Choose a WireGuard .conf and a LAN dashboard URL.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedButton(
                    onClick = { picker.launch(arrayOf("*/*")) },
                    enabled = !busy,
                ) {
                    Text(if (configName == null) "Choose .conf" else "Change .conf")
                }
                Text(
                    configName ?: "No config selected",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedTextField(
                    value = dashboardUrl,
                    onValueChange = { dashboardUrl = it },
                    label = { Text("Dashboard URL") },
                    singleLine = true,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (error != null) {
                    Text(error ?: "", color = MaterialTheme.colorScheme.error)
                }
                Button(
                    onClick = {
                        if (configText.isBlank()) {
                            error = "Choose a WireGuard .conf first."
                            return@Button
                        }
                        val uri = runCatching { URI(dashboardUrl.trim()) }.getOrNull()
                        if (
                            uri == null ||
                            (uri.scheme != "http" && uri.scheme != "https") ||
                            uri.host.isNullOrBlank()
                        ) {
                            error = "Enter an http(s) dashboard URL."
                            return@Button
                        }
                        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
                            error = "This WebView does not support per-app proxy override."
                            return@Button
                        }
                        error = null
                        busy = true
                        scope.launch {
                            try {
                                val proxy = withContext(Dispatchers.IO) { Mobile.start(configText) }
                                Log.i(TAG, "core proxy at $proxy")
                                withContext(Dispatchers.Main) {
                                    ProxyController.getInstance().setProxyOverride(
                                        ProxyConfig.Builder().addProxyRule(proxy).build(),
                                        ContextCompat.getMainExecutor(context),
                                    ) {
                                        webView.loadUrl(dashboardUrl.trim())
                                        connected = true
                                        busy = false
                                    }
                                }
                            } catch (caught: Exception) {
                                Log.e(TAG, "connect failed", caught)
                                withContext(Dispatchers.IO) { runCatching { Mobile.stop() } }
                                error = caught.message ?: caught.toString()
                                busy = false
                            }
                        }
                    },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Connect")
                    }
                }
                Text(
                    "The tunnel runs inside the app; no Android VPN slot is used.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    override fun onDestroy() {
        hideFullscreen()
        runCatching { webView.stopLoading() }
        runCatching { webView.destroy() }
        clearProxy()
        runCatching { Mobile.stop() }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "TTMD"
    }
}
