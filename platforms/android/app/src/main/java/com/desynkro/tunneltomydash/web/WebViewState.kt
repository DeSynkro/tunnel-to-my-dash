package com.desynkro.tunneltomydash.web

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebViewDatabase

/**
 * Clears dashboard cookies, site storage and Basic-auth credentials.
 *
 * The app has no other WebView content, so this state belongs to the
 * dashboard. Clearing on lock/quit matches the desktop session policy; the
 * cold-start call also covers a process kill that skipped normal teardown.
 */
internal object WebViewState {
    fun clear(context: Context) {
        runCatching {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
        }
        runCatching { WebStorage.getInstance().deleteAllData() }
        runCatching {
            WebViewDatabase.getInstance(context).clearHttpAuthUsernamePassword()
        }
    }
}
