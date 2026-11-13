package com.desynkro.tunneltomydash.service

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex

class TunnelController(private val core: CoreGateway) {
    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Stopped)
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val connectLock = Mutex()
    private val generation = AtomicInteger(0)

    suspend fun connect(profileID: String) {
        if (!connectLock.tryLock()) {
            return
        }
        val token = generation.incrementAndGet()
        try {
            _state.value = ConnectionState.Connecting(profileID)
            val info = core.startProfile(profileID)
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

    fun stop() {
        generation.incrementAndGet()
        runCatching { core.stop() }
        _state.value = ConnectionState.Stopped
    }
}
