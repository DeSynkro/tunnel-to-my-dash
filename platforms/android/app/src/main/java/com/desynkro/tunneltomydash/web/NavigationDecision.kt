package com.desynkro.tunneltomydash.web

import com.desynkro.tunneltomydash.data.NavigationKind

enum class NavigationDecision {
    LoadInWebView,
    OpenSystemBrowser,
    Block,
}

fun navigationDecision(kind: NavigationKind, openPublicLinks: Boolean): NavigationDecision =
    when (kind) {
        NavigationKind.Private -> NavigationDecision.LoadInWebView
        NavigationKind.Public -> if (openPublicLinks) {
            NavigationDecision.OpenSystemBrowser
        } else {
            NavigationDecision.Block
        }
        NavigationKind.Blocked -> NavigationDecision.Block
    }
