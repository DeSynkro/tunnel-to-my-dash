package com.desynkro.tunneltomydash

import android.app.Application
import android.webkit.WebView

class TtmdApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        container = AppContainer(this)
    }
}
