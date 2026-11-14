package com.desynkro.tunneltomydash.web

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.HttpAuthHandler
import android.webkit.WebChromeClient
import android.webkit.WebChromeClient.CustomViewCallback
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import com.desynkro.tunneltomydash.BuildConfig
import com.desynkro.tunneltomydash.data.ConnectionInfo
import com.desynkro.tunneltomydash.data.NavigationKind

class WebViewScreen(
    context: Context,
    private val info: ConnectionInfo,
    private val openPublicLinks: Boolean,
    private val lockEnabled: Boolean,
    private val navigationKind: (String) -> NavigationKind,
    private val isConnectionAlive: () -> Boolean,
    private val callbacks: Callbacks,
) : FrameLayout(context) {
    interface Callbacks {
        fun onProfiles()
        fun onLock()
        fun onStop()
        fun onReconnect()
    }

    private val activity = context as Activity
    private val webView = WebView(context)
    private lateinit var toolbar: DashboardToolbar
    private lateinit var errorView: DashboardErrorView
    private val auth = BasicAuthController(activity)
    private val handler = Handler(Looper.getMainLooper())
    private val toolbarHeight = (48 * resources.displayMetrics.density).toInt()
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var errorActive = false
    private var destroyed = false
    private var loadRunnable: Runnable? = null

    private val watchdog = Runnable {
        showError(
            "The dashboard is taking too long",
            "Check the tunnel and try again.",
        )
    }

    init {
        setBackgroundColor(Color.BLACK)

        webView.setBackgroundColor(Color.BLACK)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
        }

        addView(
            webView,
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT).apply {
                topMargin = toolbarHeight
            },
        )

        toolbar = DashboardToolbar(
            context = context,
            onBack = {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    callbacks.onProfiles()
                }
            },
            onReload = { retry() },
            onHome = { loadHome() },
            onProfiles = { callbacks.onProfiles() },
            onLock = { callbacks.onLock() },
            onStop = { callbacks.onStop() },
            allowLock = lockEnabled,
        )
        addView(toolbar, LayoutParams(LayoutParams.MATCH_PARENT, toolbarHeight))

        errorView = DashboardErrorView(
            context = context,
            onRetry = {
                if (isConnectionAlive()) {
                    retry()
                } else {
                    callbacks.onReconnect()
                }
            },
            onProfiles = { callbacks.onProfiles() },
        )
        addView(
            errorView,
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT).apply {
                topMargin = toolbarHeight
            },
        )

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val url = request?.url ?: return false
                if (request.isForMainFrame) {
                    when (navigationDecision(navigationKind(url.toString()), openPublicLinks)) {
                        NavigationDecision.LoadInWebView -> return false
                        NavigationDecision.OpenSystemBrowser -> {
                            activity.startActivity(Intent(Intent.ACTION_VIEW, url))
                            return true
                        }
                        NavigationDecision.Block -> {
                            Toast.makeText(
                                context,
                                "Public links are blocked",
                                Toast.LENGTH_SHORT,
                            ).show()
                            return true
                        }
                    }
                }
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                if (!errorActive) {
                    startWatchdog()
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (BuildConfig.DEBUG) {
                    Log.i(TAG, "page finished $url")
                }
                if (!errorActive) {
                    cancelWatchdog()
                    errorView.hide()
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                if (request?.isForMainFrame == true) {
                    showError(
                        "Could not load the dashboard",
                        "${error?.description ?: "Network error"} (${error?.errorCode ?: -1})",
                    )
                }
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                response: WebResourceResponse?,
            ) {
                val status = response?.statusCode ?: 0
                if (request?.isForMainFrame == true) {
                    if (status == 401) {
                        auth.clearCredentials()
                        showError(
                            "Sign-in failed",
                            "Check the username and password, then try again.",
                        )
                    } else if (status >= 500) {
                        showError(
                            "The dashboard returned $status",
                            request.url.toString(),
                        )
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
                auth.handle(handler, key, host, realm)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) {
                    Log.w(TAG, "console ${message.message()} @${message.lineNumber()}")
                }
                return true
            }

            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                fullscreenView = view
                fullscreenCallback = callback
                toolbar.visibility = GONE
                errorView.visibility = GONE
                (activity.window.decorView as ViewGroup).addView(
                    view,
                    ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    ),
                )
                WindowInsetsControllerCompat(activity.window, view).hide(
                    WindowInsetsCompat.Type.systemBars(),
                )
            }

            override fun onHideCustomView() {
                hideFullscreen()
            }
        }
    }

    fun handleBack(): Boolean {
        if (webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return false
    }

    fun setProxyAndLoad(proxy: String) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            showError(
                "This WebView is too old",
                "Per-app proxy override is not supported.",
            )
            return
        }
        ProxyController.getInstance().setProxyOverride(
            ProxyConfig.Builder().addProxyRule(proxy).build(),
            ContextCompat.getMainExecutor(context),
        ) {
            loadHome()
        }
    }

    fun destroyScreen() {
        destroyed = true
        loadRunnable?.let { handler.removeCallbacks(it) }
        loadRunnable = null
        hideFullscreen()
        cancelWatchdog()
        auth.clear()
        runCatching { webView.stopLoading() }
        runCatching { webView.loadUrl("about:blank") }
        runCatching { webView.destroy() }
        runCatching {
            ProxyController.getInstance().clearProxyOverride(
                ContextCompat.getMainExecutor(context),
            ) {}
        }
        removeAllViews()
    }

    override fun onDetachedFromWindow() {
        cancelWatchdog()
        super.onDetachedFromWindow()
    }

    private fun loadHome() {
        clearError()
        whenReady {
            startWatchdog()
            webView.loadUrl(info.dashboardURL)
        }
    }

    private fun retry() {
        clearError()
        whenReady {
            startWatchdog()
            webView.reload()
        }
    }

    /**
     * Runs [action] only after the WebView is attached and has a real size.
     * Loading into a zero-height WebView collapses full-height dashboards.
     */
    private fun whenReady(action: () -> Unit) {
        if (destroyed) {
            return
        }
        if (isAttachedToWindow && webView.width > 0 && webView.height > 0) {
            action()
            return
        }
        loadRunnable?.let { handler.removeCallbacks(it) }
        val runnable = object : Runnable {
            override fun run() {
                if (destroyed) {
                    return
                }
                if (!isAttachedToWindow || webView.width <= 0 || webView.height <= 0) {
                    handler.postDelayed(this, 16L)
                    return
                }
                loadRunnable = null
                action()
            }
        }
        loadRunnable = runnable
        handler.post(runnable)
    }

    private fun clearError() {
        errorActive = false
        errorView.hide()
        cancelWatchdog()
    }

    private fun showError(title: String, message: String) {
        errorActive = true
        cancelWatchdog()
        errorView.show(title, message)
    }

    private fun startWatchdog() {
        handler.removeCallbacks(watchdog)
        handler.postDelayed(watchdog, WATCHDOG_MS)
    }

    private fun cancelWatchdog() {
        handler.removeCallbacks(watchdog)
    }

    private fun hideFullscreen() {
        val view = fullscreenView ?: return
        (activity.window.decorView as ViewGroup).removeView(view)
        fullscreenView = null
        WindowInsetsControllerCompat(activity.window, activity.window.decorView).show(
            WindowInsetsCompat.Type.systemBars(),
        )
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
        toolbar.visibility = VISIBLE
    }

    companion object {
        private const val TAG = "TTMD"
        private const val WATCHDOG_MS = 20_000L
    }
}
