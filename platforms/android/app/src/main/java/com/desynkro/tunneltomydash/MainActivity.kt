package com.desynkro.tunneltomydash

import android.Manifest
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.desynkro.tunneltomydash.data.ConnectionInfo
import com.desynkro.tunneltomydash.data.ProfileSummary
import com.desynkro.tunneltomydash.service.ConnectionState
import com.desynkro.tunneltomydash.service.TunnelService
import com.desynkro.tunneltomydash.service.shouldAutoConnect
import com.desynkro.tunneltomydash.ui.AppRoot
import com.desynkro.tunneltomydash.ui.AppScreen
import com.desynkro.tunneltomydash.ui.AppUiState
import com.desynkro.tunneltomydash.ui.AppViewModel
import com.desynkro.tunneltomydash.ui.LockCoordinator
import com.desynkro.tunneltomydash.ui.TtmdTheme
import com.desynkro.tunneltomydash.web.WebViewScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : FragmentActivity() {
    private val container: AppContainer
        get() = (application as TtmdApplication).container

    private val viewModel: AppViewModel by viewModels {
        AppViewModel.factory(container.repository)
    }

    private val lockCoordinator = LockCoordinator()
    private lateinit var rootView: FrameLayout
    private lateinit var composeView: ComposeView
    private var webViewScreen: WebViewScreen? = null
    private var currentInfo: ConnectionInfo? = null
    private var lastConnectProfile: ProfileSummary? = null
    private var pendingConnect: ProfileSummary? = null
    private var autoConnectAttempted = false
    private var connectionErrorDialog: AlertDialog? = null
    private var biometricEnabled by mutableStateOf(false)

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        lockCoordinator.leaveExternalActivity()
        val pending = pendingConnect
        pendingConnect = null
        if (pending != null) {
            TunnelService.start(this, pending.id, pending.name)
        }
        if (!granted) {
            Toast.makeText(
                this,
                "Notifications are off. The tunnel can still run.",
                Toast.LENGTH_LONG,
            ).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        biometricEnabled = container.biometric.isEnabled()

        rootView = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }
        composeView = ComposeView(this).apply {
            setContent {
                TtmdTheme {
                    AppRoot(
                        viewModel = viewModel,
                        onConnect = { profileID ->
                            viewModel.state.value.profiles
                                .firstOrNull { it.id == profileID }
                                ?.let(::connect)
                        },
                        onExternalActivityStart = lockCoordinator::enterExternalActivity,
                        onExternalActivityEnd = lockCoordinator::leaveExternalActivity,
                        biometricAvailable = container.biometric.isAvailable(),
                        biometricEnabled = biometricEnabled,
                        onEnableBiometrics = { password ->
                            withContext(Dispatchers.IO) {
                                container.biometric.enable(password)
                            }
                            biometricEnabled = true
                        },
                        onDisableBiometrics = {
                            container.biometric.disable()
                            biometricEnabled = false
                        },
                        onBiometricUnlock = {
                            container.biometric.prompt(
                                this@MainActivity,
                                onSuccess = { password -> viewModel.unlock(password) },
                                onError = { code, message ->
                                    if (
                                        code != BiometricPrompt.ERROR_NEGATIVE_BUTTON &&
                                        code != BiometricPrompt.ERROR_CANCELED &&
                                        code != BiometricPrompt.ERROR_USER_CANCELED
                                    ) {
                                        Toast.makeText(
                                            this@MainActivity,
                                            message,
                                            Toast.LENGTH_SHORT,
                                        ).show()
                                    }
                                },
                            )
                        },
                    )
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

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.state.collect { state -> onAppState(state) }
                }
                launch {
                    container.tunnel.state.collect { state -> onConnectionState(state) }
                }
            }
        }
    }

    override fun onStop() {
        super.onStop()
        val state = viewModel.state.value
        if (lockCoordinator.shouldLock(state.vaultStatus, state.settings)) {
            viewModel.lock()
            destroyWebViewScreen()
            composeView.visibility = View.VISIBLE
        }
    }

    override fun onDestroy() {
        connectionErrorDialog?.dismiss()
        connectionErrorDialog = null
        destroyWebViewScreen()
        if (isFinishing) {
            TunnelService.stop(this)
        }
        super.onDestroy()
    }

    private fun connect(profile: ProfileSummary) {
        lastConnectProfile = profile
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingConnect = profile
            lockCoordinator.enterExternalActivity()
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        TunnelService.start(this, profile.id, profile.name)
    }

    private fun onAppState(state: AppUiState) {
        if (state.vaultStatus.locked) {
            destroyWebViewScreen()
            composeView.visibility = View.VISIBLE
            return
        }

        val connection = container.tunnel.state.value
        if (connection is ConnectionState.Connected) {
            showDashboard(connection.info)
        }

        if (
            !autoConnectAttempted &&
            state.screen == AppScreen.Profiles &&
            shouldAutoConnect(state.settings, state.profiles, connection)
        ) {
            autoConnectAttempted = true
            state.profiles.firstOrNull { it.active }?.let(::connect)
        }
    }

    private fun onConnectionState(state: ConnectionState) {
        when (state) {
            is ConnectionState.Connected -> {
                if (viewModel.state.value.vaultStatus.locked) {
                    destroyWebViewScreen()
                } else {
                    showDashboard(state.info)
                }
            }
            is ConnectionState.Connecting -> {
                composeView.visibility = View.VISIBLE
                destroyWebViewScreen()
            }
            is ConnectionState.Error -> {
                composeView.visibility = View.VISIBLE
                destroyWebViewScreen()
                showConnectionError(state.message)
            }
            ConnectionState.Stopped -> {
                composeView.visibility = View.VISIBLE
                destroyWebViewScreen()
            }
        }
    }

    private fun showDashboard(info: ConnectionInfo) {
        if (webViewScreen != null && currentInfo?.profileID == info.profileID) {
            composeView.visibility = View.GONE
            return
        }

        destroyWebViewScreen()
        composeView.visibility = View.GONE
        currentInfo = info

        val screen = WebViewScreen(
            context = this,
            info = info,
            openPublicLinks = viewModel.state.value.settings.openPublicLinksInBrowser,
            navigationKind = { url -> container.repository.navigationKind(url) },
            callbacks = object : WebViewScreen.Callbacks {
                override fun onProfiles() = stopConnection()

                override fun onLock() = lockUi()

                override fun onStop() = stopConnection()
            },
        )
        rootView.addView(
            screen,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        webViewScreen = screen
        screen.setProxyAndLoad(info.proxy)
    }

    private fun destroyWebViewScreen() {
        val screen = webViewScreen ?: return
        rootView.removeView(screen)
        screen.destroyScreen()
        webViewScreen = null
        currentInfo = null
    }

    private fun stopConnection() {
        TunnelService.stop(this)
        lastConnectProfile = null
        viewModel.backToProfiles()
        composeView.visibility = View.VISIBLE
        destroyWebViewScreen()
    }

    private fun lockUi() {
        viewModel.lock()
        destroyWebViewScreen()
        composeView.visibility = View.VISIBLE
    }

    private fun showConnectionError(message: String) {
        if (connectionErrorDialog?.isShowing == true) {
            return
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("Connection failed")
            .setMessage(message)
            .setPositiveButton("Try again") { _, _ ->
                lastConnectProfile?.let(::connect)
            }
            .setNegativeButton("Profile list") { _, _ ->
                stopConnection()
            }
            .setOnCancelListener {
                stopConnection()
            }
            .create()
        dialog.setOnDismissListener {
            connectionErrorDialog = null
        }
        connectionErrorDialog = dialog
        dialog.show()
    }
}
