package com.desynkro.tunneltomydash.service

import com.desynkro.tunneltomydash.data.ConnectionInfo

sealed interface ConnectionState {
    data object Stopped : ConnectionState
    data class Connecting(val profileID: String) : ConnectionState
    data class Connected(val info: ConnectionInfo) : ConnectionState
    data class Error(val message: String) : ConnectionState
}
