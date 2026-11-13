package com.desynkro.tunneltomydash.service

import com.desynkro.tunneltomydash.data.ConnectionInfo
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TunnelControllerTest {
    private val info = ConnectionInfo(
        proxy = "127.0.0.1:41000",
        dashboardURL = "http://192.168.0.3:3000",
        profileID = "profile",
        profileName = "Home",
    )

    @Test
    fun connectEmitsConnectingThenConnected() = runTest {
        val core = FakeCore(info = info, suspendStart = true)
        val controller = TunnelController(core)

        val job = launch { controller.connect("profile") }
        core.started.await()
        assertEquals(ConnectionState.Connecting("profile"), controller.state.value)

        core.release.complete(Unit)
        job.join()
        assertEquals(ConnectionState.Connected(info), controller.state.value)
    }

    @Test
    fun connectFailureEmitsError() = runTest {
        val core = FakeCore(
            info = info,
            error = IllegalStateException("tunnel failed"),
        )
        val controller = TunnelController(core)

        controller.connect("profile")

        assertEquals(ConnectionState.Error("tunnel failed"), controller.state.value)
    }

    @Test
    fun stopStopsCoreAndMovesToStopped() = runTest {
        val core = FakeCore(info = info)
        val controller = TunnelController(core)
        controller.connect("profile")

        controller.stop()

        assertEquals(ConnectionState.Stopped, controller.state.value)
        assertEquals(1, core.stopCalls)
    }

    @Test
    fun secondConnectWhileRunningDoesNotStartTwice() = runTest {
        val core = FakeCore(info = info, suspendStart = true)
        val controller = TunnelController(core)

        val first = launch { controller.connect("profile") }
        core.started.await()
        val second = launch { controller.connect("profile") }
        second.join()

        assertEquals(1, core.startCalls)

        core.release.complete(Unit)
        first.join()
        assertEquals(ConnectionState.Connected(info), controller.state.value)
    }

    @Test
    fun stopDuringConnectDoesNotBecomeConnected() = runTest {
        val core = FakeCore(info = info, suspendStart = true)
        val controller = TunnelController(core)

        val job = launch { controller.connect("profile") }
        core.started.await()
        controller.stop()
        core.release.complete(Unit)
        job.join()

        assertEquals(ConnectionState.Stopped, controller.state.value)
        assertEquals(1, core.stopCalls)
    }
}

private class FakeCore(
    private val info: ConnectionInfo,
    private val error: Throwable? = null,
    private val suspendStart: Boolean = false,
) : CoreGateway {
    var startCalls = 0
    var stopCalls = 0
    val started = CompletableDeferred<Unit>()
    val release = CompletableDeferred<Unit>()

    override suspend fun startProfile(profileID: String): ConnectionInfo {
        startCalls++
        started.complete(Unit)
        if (suspendStart) {
            release.await()
        }
        error?.let { throw it }
        return info.copy(profileID = profileID)
    }

    override fun stop() {
        stopCalls++
    }
}
