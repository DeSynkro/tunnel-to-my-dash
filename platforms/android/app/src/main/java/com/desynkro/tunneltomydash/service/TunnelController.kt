package com.desynkro.tunneltomydash.service

import com.desynkro.tunneltomydash.data.ConnectionInfo
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicInteger

class TunnelController(
    private val core: CoreGateway,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Stopped)
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val connectLock = Mutex()
    private val generation = AtomicInteger(0)

    suspend fun connect(profileID: String) {
        val current = _state.value
        if (current is ConnectionState.Connecting || current is ConnectionState.Connected) {
            return
        }
        if (!connectLock.tryLock()) {
            return
        }
        val token = generation.incrementAndGet()
        try {
            _state.value = ConnectionState.Connecting(profileID)
            val info = withContext(ioDispatcher) { core.startProfile(profileID) }
            if (token == generation.get()) {
                _state.value = ConnectionState.Connected(info)
            }
        } catch (caught: Throwable) {
            if (token == generation.get()) {
                _state.value = ConnectionState.Error(
                    caught.message ?: "Could not connect to the dashboard",
                )
            }
        } finally {
            connectLock.unlock()
        }
    }

    /**
     * Stops the tunnel. If a start is in flight, this waits for it to finish
     * and then closes it, so a late start cannot orphan the Go tunnel.
     */
    suspend fun stop() {
        generation.incrementAndGet()
        connectLock.withLock {
            withContext(ioDispatcher) {
                runCatching { core.stop() }
            }
        }
        _state.value = ConnectionState.Stopped
    }
}
