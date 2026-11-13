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
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
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
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : FragmentActivity() {
    private val container: AppContainer
        get() = (application as TtmdApplication).container

    private val viewModel: AppViewModel by viewModels {
        AppViewModel.factory(container.repository, container.appScope)
    }

    private val lockCoordinator = LockCoordinator()
    private val uiPrefs by lazy { getSharedPreferences("ui", MODE_PRIVATE) }
    private lateinit var rootView: FrameLayout
    private lateinit var composeView: ComposeView
    private var webViewScreen: WebViewScreen? = null
    private var currentInfo: ConnectionInfo? = null
    private var lastConnectProfile: ProfileSummary? = null
    private var pendingConnect: ProfileSummary? = null
    private var autoConnectAttempted = false
    private var connectionErrorDialog: AlertDialog? = null
    private var biometricEnabled by mutableStateOf(false)
    private var connectionState by mutableStateOf<ConnectionState>(ConnectionState.Stopped)
    private var lostConnection by mutableStateOf(false)
    private var restoredProfileID: String? = null

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        uiPrefs.edit().putBoolean(KEY_NOTIFICATION_ASKED, true).apply()
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
        WindowCompat.setDecorFitsSystemWindows(window, false)
        biometricEnabled = container.biometric.isEnabled()
        connectionState = container.tunnel.state.value
        restoredProfileID = savedInstanceState?.getString(KEY_PROFILE_ID)
        lostConnection = savedInstanceState?.getBoolean(KEY_WAS_CONNECTED) == true

        rootView = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }
        ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
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
                        onDisconnect = ::stopConnection,
                        onRetryLostConnection = ::retryLostConnection,
                        connectionState = connectionState,
                        lostConnection = lostConnection &&
                            connectionState is ConnectionState.Stopped,
                        onExternalActivityStart = lockCoordinator::enterExternalActivity,
                        onExternalActivityEnd = lockCoordinator::leaveExternalActivity,
                        biometricAvailable = container.biometric.isAvailable(),
                        biometricEnabled = biometricEnabled,
                        onEnableBiometrics = { password ->
                            withContext(Dispatchers.IO) {
                                container.repository.verifyPassword(password)
                            }
                            val enabled = container.biometric.enable(
                                this@MainActivity,
                                password,
                            )
                            biometricEnabled = enabled
                            enabled
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
                                    if (!container.biometric.isEnabled()) {
                                        biometricEnabled = false
                                    }
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
                        onChangePassword = { oldPassword, newPassword ->
                            withContext(NonCancellable) {
                                viewModel.changePassword(oldPassword, newPassword)
                                container.biometric.disable()
                                biometricEnabled = false
                            }
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
        ViewCompat.requestApplyInsets(rootView)

        onBackPressedDispatcher.addCallback(this) {
            when {
                webViewScreen?.handleBack() == true -> Unit
                viewModel.state.value.vaultStatus.locked -> finish()
                connectionState is ConnectionState.Connecting -> stopConnection()
                viewModel.state.value.screen is AppScreen.EditProfile ||
                    viewModel.state.value.screen == AppScreen.Settings ->
                    viewModel.backToProfiles()
                else -> finish()
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state -> onAppState(state) }
            }
        }
        lifecycleScope.launch {
            container.tunnel.state.collect { state -> onConnectionState(state) }
        }
    }

    override fun onResume() {
        super.onResume()
        biometricEnabled = container.biometric.isEnabled()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(KEY_WAS_CONNECTED, connectionState !is ConnectionState.Stopped)
        (currentInfo?.profileID ?: lastConnectProfile?.id)?.let {
            outState.putString(KEY_PROFILE_ID, it)
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
        val state = viewModel.state.value
        if (lockCoordinator.shouldLock(state.vaultStatus, state.settings)) {
            container.appScope.launch {
                runCatching { container.repository.lock() }
            }
        }
        destroyWebViewScreen()
        super.onDestroy()
    }

    private fun connect(profile: ProfileSummary) {
        if (
            connectionState !is ConnectionState.Stopped &&
            connectionState !is ConnectionState.Error
        ) {
            return
        }
        lastConnectProfile = profile
        lostConnection = false
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED &&
            !uiPrefs.getBoolean(KEY_NOTIFICATION_ASKED, false)
        ) {
            pendingConnect = profile
            lockCoordinator.enterExternalActivity()
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        TunnelService.start(this, profile.id, profile.name)
    }

    private fun retryLostConnection() {
        val profiles = viewModel.state.value.profiles
        val profile = profiles.firstOrNull { it.id == restoredProfileID }
            ?: profiles.firstOrNull { it.active }
            ?: return
        connect(profile)
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
        } else if (connection is ConnectionState.Error) {
            showConnectionError(connection.message)
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
        connectionState = state
        if (state !is ConnectionState.Stopped) {
            lostConnection = false
        }
        when (state) {
            is ConnectionState.Connected -> {
                if (viewModel.state.value.vaultStatus.locked) {
                    destroyWebViewScreen()
                } else if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
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
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                    showConnectionError(state.message)
                }
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
            lockEnabled = viewModel.state.value.vaultStatus.passwordProtected,
            navigationKind = { url -> container.repository.navigationKind(url) },
            isConnectionAlive = { container.tunnel.state.value is ConnectionState.Connected },
            callbacks = object : WebViewScreen.Callbacks {
                override fun onProfiles() = stopConnection()

                override fun onLock() = lockUi()

                override fun onStop() = stopConnection()

                override fun onReconnect() {
                    lastConnectProfile?.let(::connect) ?: retryLostConnection()
                }
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
        container.appScope.launch { container.tunnel.stop() }
        lastConnectProfile = null
        lostConnection = false
        if (!viewModel.state.value.vaultStatus.locked) {
            viewModel.backToProfiles()
        }
        composeView.visibility = View.VISIBLE
        destroyWebViewScreen()
    }

    private fun lockUi() {
        if (!viewModel.state.value.vaultStatus.passwordProtected) {
            return
        }
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
                    ?: retryLostConnection()
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

    companion object {
        private const val KEY_WAS_CONNECTED = "was_connected"
        private const val KEY_PROFILE_ID = "profile_id"
        private const val KEY_NOTIFICATION_ASKED = "notification_permission_asked"
    }
}
