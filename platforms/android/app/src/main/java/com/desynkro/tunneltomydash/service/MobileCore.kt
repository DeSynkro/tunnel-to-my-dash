package com.desynkro.tunneltomydash.service

import com.desynkro.tunneltomydash.data.ConnectionInfo
import com.desynkro.tunneltomydash.data.parseConnectionInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import mobile.Mobile

class MobileCore : CoreGateway {
    override suspend fun startProfile(profileID: String): ConnectionInfo =
        withContext(Dispatchers.IO) {
            parseConnectionInfo(Mobile.startProfile(profileID))
        }

    override fun stop() {
        Mobile.stop()
    }
}
