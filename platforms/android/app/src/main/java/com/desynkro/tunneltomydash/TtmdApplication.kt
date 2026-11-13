package com.desynkro.tunneltomydash

import android.app.Application

class TtmdApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
