package com.desynkro.tunneltomydash

import android.app.AlertDialog
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.HttpAuthHandler
import android.webkit.WebChromeClient
import android.webkit.WebChromeClient.CustomViewCallback
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
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
    private var webView: WebView? = null
    private lateinit var rootView: FrameLayout
    private lateinit var composeView: ComposeView
    private var debugControls: LinearLayout? = null
    private var fullscreenView: View? = null
    private var fullscreenCallback: CustomViewCallback? = null
    private val httpAuthCredentials = mutableMapOf<String, Pair<String, String>>()
    private val pendingHttpAuth = mutableListOf<PendingHttpAuth>()
    private var httpAuthDialog: AlertDialog? = null
    private var pendingLoadRunnable: Runnable? = null
    private var loadGeneration = 0

    private data class PendingHttpAuth(
        val handler: HttpAuthHandler,
        val key: String,
        val host: String,
        val realm: String?,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        rootView = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }
        composeView = ComposeView(this).apply {
            setContent {
                MaterialTheme(colorScheme = darkColorScheme()) {
                    AppScreen()
                }
            }
        }
        rootView.addView(
            composeView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(rootView)
    }

    private fun createWebView(): WebView {
        return WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            Log.i(
                TAG,
                "webview settings wide=${settings.useWideViewPort} " +
                    "overview=${settings.loadWithOverviewMode} " +
                    "density=${resources.displayMetrics.density} " +
                    "screen=${resources.displayMetrics.widthPixels}x${resources.displayMetrics.heightPixels}",
            )
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?,
                ): WebResourceResponse? {
                    Log.d(TAG, "request ${request?.url}")
                    return super.shouldInterceptRequest(view, request)
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    Log.i(TAG, "page finished $url")
                    applyReveal(view)
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?,
                ) {
                    Log.e(TAG, "web error ${request?.url} ${error?.errorCode} ${error?.description}")
                }

                override fun onReceivedHttpError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    response: WebResourceResponse?,
                ) {
                    Log.e(TAG, "http ${response?.statusCode} ${request?.url}")
                    if (response?.statusCode == 401) {
                        val host = request?.url?.host.orEmpty()
                        if (host.isNotEmpty()) {
                            httpAuthCredentials.keys.removeAll { it == host || it.startsWith("$host:") }
                        }
                    }
                }

                override fun onReceivedHttpAuthRequest(
                    view: WebView?,
                    handler: HttpAuthHandler?,
                    host: String?,
                    realm: String?,
                ) {
                    if (handler == null) {
                        return
                    }
                    if (host.isNullOrBlank()) {
                        handler.cancel()
                        return
                    }
                    val port = runCatching { Uri.parse(view?.url ?: "").port }.getOrDefault(-1)
                    val key = if (port > 0) "$host:$port" else host
                    val cached = httpAuthCredentials[key]
                    if (cached != null) {
                        handler.proceed(cached.first, cached.second)
                        return
                    }
                    pendingHttpAuth.add(PendingHttpAuth(handler, key, host, realm))
                    showNextHttpAuthDialog()
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.w(TAG, "console ${message.message()} @${message.lineNumber()}")
                    return true
                }

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

    private fun showNextHttpAuthDialog() {
        if (httpAuthDialog?.isShowing == true) {
            return
        }
        httpAuthDialog = null
        val next = pendingHttpAuth.firstOrNull() ?: return
        showHttpAuthDialog(next)
    }

    private fun showHttpAuthDialog(request: PendingHttpAuth) {
        if (isFinishing || isDestroyed) {
            pendingHttpAuth.removeAll { it.key == request.key }
            request.handler.cancel()
            return
        }

        val padding = (20 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding / 2, padding, 0)
        }
        val username = EditText(this).apply {
            hint = "Username"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_EDIT_TEXT
            setSingleLine()
        }
        val password = EditText(this).apply {
            hint = "Password"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine()
        }
        layout.addView(username)
        layout.addView(password)

        val dialog = AlertDialog.Builder(this)
            .setTitle("Sign in to ${request.host}")
            .setMessage(
                request.realm?.takeIf { it.isNotBlank() }
                    ?: "This site requires a username and password.",
            )
            .setView(layout)
            .setPositiveButton("Sign in", null)
            .setNegativeButton("Cancel") { _, _ -> cancelHttpAuth(request.key) }
            .setOnCancelListener { cancelHttpAuth(request.key) }
            .create()

        dialog.setOnShowListener {
            username.requestFocus()
            dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val user = username.text.toString()
                val pass = password.text.toString()
                if (user.isBlank()) {
                    username.error = "Enter the username"
                    return@setOnClickListener
                }
                httpAuthCredentials[request.key] = user to pass
                httpAuthDialog = null
                dialog.dismiss()
                val matching = pendingHttpAuth.filter { it.key == request.key }
                pendingHttpAuth.removeAll { it.key == request.key }
                matching.forEach { it.handler.proceed(user, pass) }
                showNextHttpAuthDialog()
            }
        }

        httpAuthDialog = dialog
        dialog.show()
    }

    private fun cancelHttpAuth(key: String) {
        httpAuthDialog?.dismiss()
        httpAuthDialog = null
        val matching = pendingHttpAuth.filter { it.key == key }
        pendingHttpAuth.removeAll { it.key == key }
        matching.forEach { it.handler.cancel() }
        showNextHttpAuthDialog()
    }

    private fun clearHttpAuth() {
        httpAuthDialog?.dismiss()
        httpAuthDialog = null
        pendingHttpAuth.forEach { it.handler.cancel() }
        pendingHttpAuth.clear()
        httpAuthCredentials.clear()
    }

    private fun cancelPendingLoad() {
        loadGeneration++
        pendingLoadRunnable?.let { webView?.removeCallbacks(it) }
        pendingLoadRunnable = null
    }

    private fun loadWhenReady(url: String) {
        val target = webView ?: return
        cancelPendingLoad()
        val generation = loadGeneration
        val attempt = object : Runnable {
            override fun run() {
                if (generation != loadGeneration || webView !== target) {
                    return
                }
                if (!target.isAttachedToWindow || target.width <= 0 || target.height <= 0) {
                    target.postDelayed(this, 16L)
                    return
                }
                target.postOnAnimation(object : Runnable {
                    override fun run() {
                        if (generation != loadGeneration || webView !== target) {
                            return
                        }
                        if (!target.isAttachedToWindow || target.width <= 0 || target.height <= 0) {
                            pendingLoadRunnable?.let { target.postDelayed(it, 16L) }
                            return
                        }
                        Log.i(TAG, "webview ready ${target.width}x${target.height}; loading $url")
                        target.loadUrl(url)
                    }
                })
            }
        }
        pendingLoadRunnable = attempt
        target.post(attempt)
    }

    private fun showWebView(url: String) {
        if (webView != null) {
            return
        }
        val created = createWebView()
        webView = created
        rootView.addView(
            created,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        composeView.visibility = View.GONE
        addDebugControls()
        loadWhenReady(url)
    }

    private fun addDebugControls() {
        if (debugControls != null) {
            return
        }
        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP or Gravity.END
            setPadding(12, 12, 12, 12)
        }
        fun addButton(label: String, action: () -> Unit) {
            controls.addView(
                Button(this@MainActivity).apply {
                    text = label
                    setOnClickListener { action() }
                },
            )
        }
        addButton("Back") {
            val current = webView
            if (current?.canGoBack() == true) {
                current.goBack()
            } else {
                disconnect()
            }
        }
        addButton("Reveal") { applyReveal() }
        addButton("Dump") { dumpPage() }
        addButton("Stop") { disconnect() }
        rootView.addView(
            controls,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.END,
            ),
        )
        debugControls = controls
    }

    private fun releaseWebView() {
        cancelPendingLoad()
        val current = webView
        webView = null
        debugControls?.let { rootView.removeView(it) }
        debugControls = null
        current?.let { rootView.removeView(it) }
        runCatching { current?.stopLoading() }
        runCatching { current?.loadUrl("about:blank") }
        runCatching { current?.destroy() }
        clearProxy()
        clearHttpAuth()
    }

    private fun disconnect() {
        releaseWebView()
        composeView.visibility = View.VISIBLE
        Thread { runCatching { Mobile.stop() } }.start()
    }

    private fun dumpPage() {
        webView?.evaluateJavascript(
            """
            (function () {
              const body = document.body;
              return JSON.stringify({
                href: location.href,
                title: document.title,
                ready: document.readyState,
                width: window.innerWidth,
                height: window.innerHeight,
                links: document.querySelectorAll("a").length,
                images: document.querySelectorAll("img").length,
                text: body && body.innerText ? body.innerText.slice(0, 600) : "",
                reveal: !!document.getElementById("__ttmd_reveal"),
              });
            })()
            """.trimIndent(),
        ) { value ->
            Log.i(TAG, "page dump $value")
        }
    }

    private fun applyReveal(target: WebView? = webView) {
        target?.evaluateJavascript(
            """
            (function () {
              const root = document.documentElement;
              if (!root || document.getElementById("__ttmd_reveal")) return;
              const style = document.createElement("style");
              style.id = "__ttmd_reveal";
              style.textContent =
                "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}" +
                "*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}";
              root.appendChild(style);
            })()
            """.trimIndent(),
        ) { Log.i(TAG, "reveal injected") }
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
        var allowExternal by remember { mutableStateOf(false) }
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
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Switch(
                    checked = allowExternal,
                    onCheckedChange = { allowExternal = it },
                    enabled = !busy,
                )
                Text("Allow external content")
            }
            Text(
                "Widgets, fonts or icons hosted outside the LAN.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                    Log.i(TAG, "starting core external=$allowExternal")
                    scope.launch {
                        try {
                            val proxy = withContext(Dispatchers.IO) {
                                Mobile.start(configText, allowExternal)
                            }
                            Log.i(TAG, "core proxy at $proxy")
                            withContext(Dispatchers.Main) {
                                ProxyController.getInstance().setProxyOverride(
                                    ProxyConfig.Builder().addProxyRule(proxy).build(),
                                    ContextCompat.getMainExecutor(context),
                                ) {
                                    busy = false
                                    showWebView(dashboardUrl.trim())
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

    override fun onDestroy() {
        hideFullscreen()
        releaseWebView()
        runCatching { Mobile.stop() }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "TTMD"
    }
}
