package com.desynkro.tunneltomydash.service

import com.desynkro.tunneltomydash.data.ConnectionInfo
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
        val controller = TunnelController(core, UnconfinedTestDispatcher(testScheduler))

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
        val controller = TunnelController(core, UnconfinedTestDispatcher(testScheduler))

        controller.connect("profile")

        assertEquals(ConnectionState.Error("tunnel failed"), controller.state.value)
    }

    @Test
    fun stopStopsCoreAndMovesToStopped() = runTest {
        val core = FakeCore(info = info)
        val controller = TunnelController(core, UnconfinedTestDispatcher(testScheduler))
        controller.connect("profile")

        controller.stop()

        assertEquals(ConnectionState.Stopped, controller.state.value)
        assertEquals(1, core.stopCalls)
        assertFalse(core.tunnelActive)
    }

    @Test
    fun secondConnectWhileRunningDoesNotStartTwice() = runTest {
        val core = FakeCore(info = info, suspendStart = true)
        val controller = TunnelController(core, UnconfinedTestDispatcher(testScheduler))

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
    fun connectWhileConnectedIsIgnored() = runTest {
        val core = FakeCore(info = info)
        val controller = TunnelController(core, UnconfinedTestDispatcher(testScheduler))
        controller.connect("profile")

        controller.connect("profile")

        assertEquals(1, core.startCalls)
        assertEquals(ConnectionState.Connected(info), controller.state.value)
    }

    @Test
    fun stopDuringConnectWaitsForLateStartAndClosesIt() = runTest {
        val core = FakeCore(info = info, suspendStart = true)
        val controller = TunnelController(core, UnconfinedTestDispatcher(testScheduler))

        val connectJob = launch { controller.connect("profile") }
        core.started.await()
        val stopJob = launch { controller.stop() }
        core.release.complete(Unit)
        connectJob.join()
        stopJob.join()

        assertEquals(ConnectionState.Stopped, controller.state.value)
        assertEquals(1, core.stopCalls)
        assertFalse(core.tunnelActive)
        assertTrue(core.stoppedAfterStart)
    }
}

private class FakeCore(
    private val info: ConnectionInfo,
    private val error: Throwable? = null,
    private val suspendStart: Boolean = false,
) : CoreGateway {
    var startCalls = 0
    var stopCalls = 0
    var tunnelActive = false
    var stoppedAfterStart = false
    val started = CompletableDeferred<Unit>()
    val release = CompletableDeferred<Unit>()

    override suspend fun startProfile(profileID: String): ConnectionInfo {
        startCalls++
        started.complete(Unit)
        if (suspendStart) {
            release.await()
        }
        error?.let { throw it }
        tunnelActive = true
        return info.copy(profileID = profileID)
    }

    override fun stop() {
        stopCalls++
        if (startCalls > 0) {
            stoppedAfterStart = true
        }
        tunnelActive = false
    }
}
