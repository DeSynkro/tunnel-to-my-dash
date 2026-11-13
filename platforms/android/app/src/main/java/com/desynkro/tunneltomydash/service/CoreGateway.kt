package com.desynkro.tunneltomydash.service

import com.desynkro.tunneltomydash.data.ConnectionInfo

interface CoreGateway {
    suspend fun startProfile(profileID: String): ConnectionInfo
    fun stop()
}
