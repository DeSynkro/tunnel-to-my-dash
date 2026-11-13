package com.desynkro.tunneltomydash.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.desynkro.tunneltomydash.AppContainer
import com.desynkro.tunneltomydash.MainActivity
import com.desynkro.tunneltomydash.R
import com.desynkro.tunneltomydash.TtmdApplication
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

class TunnelService : Service() {
    private val container: AppContainer
        get() = (application as TtmdApplication).container

    private val controller: TunnelController
        get() = container.tunnel

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var observeJob: Job? = null
    private var foregroundStarted = false

    override fun onCreate() {
        super.onCreate()
        createChannel()
        observeJob = serviceScope.launch {
            controller.state.collect { state ->
                if (foregroundStarted && state !is ConnectionState.Stopped) {
                    updateNotification(state)
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val profileID = intent.getStringExtra(EXTRA_PROFILE_ID) ?: return START_NOT_STICKY
                val profileName = intent.getStringExtra(EXTRA_PROFILE_NAME).orEmpty()
                foregroundStarted = true
                startForegroundCompat(
                    "Connecting to ${profileName.ifBlank { "dashboard" }}",
                )
                serviceScope.launch {
                    controller.connect(profileID)
                }
            }
            ACTION_STOP -> stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        foregroundStarted = false
        observeJob?.cancel()
        // The application scope outlives this service, so a stop that has to
        // wait for an in-flight start still closes the Go tunnel.
        container.appScope.launch {
            container.tunnel.stop()
        }
        serviceScope.cancel()
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
        super.onDestroy()
    }

    private fun startForegroundCompat(text: String) {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(text), type)
    }

    private fun updateNotification(state: ConnectionState) {
        val text = when (state) {
            is ConnectionState.Connecting -> "Connecting…"
            is ConnectionState.Connected -> "Connected to ${state.info.profileName}"
            is ConnectionState.Error -> "Connection failed"
            ConnectionState.Stopped -> return
        }
        runCatching {
            NotificationManagerCompat.from(this).notify(
                NOTIFICATION_ID,
                buildNotification(text),
            )
        }
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, TunnelService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_ttmd)
            .setContentTitle("Tunnel to My Dash")
            .setContentText(text)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(0, "Stop", stopIntent)
            .build()
    }

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Tunnel connection",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Shows the active tunnel connection"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_START = "com.desynkro.tunneltomydash.action.START"
        const val ACTION_STOP = "com.desynkro.tunneltomydash.action.STOP"
        private const val EXTRA_PROFILE_ID = "profile_id"
        private const val EXTRA_PROFILE_NAME = "profile_name"
        private const val CHANNEL_ID = "tunnel"
        private const val NOTIFICATION_ID = 1

        fun start(context: Context, profileID: String, profileName: String) {
            val intent = Intent(context, TunnelService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_PROFILE_ID, profileID)
                putExtra(EXTRA_PROFILE_NAME, profileName)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TunnelService::class.java))
        }
    }
}
