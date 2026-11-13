package com.desynkro.tunneltomydash.web

import com.desynkro.tunneltomydash.data.NavigationKind
import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationDecisionTest {
    @Test
    fun privateLinksStayInTheWebView() {
        assertEquals(
            NavigationDecision.LoadInWebView,
            navigationDecision(NavigationKind.Private, openPublicLinks = false),
        )
        assertEquals(
            NavigationDecision.LoadInWebView,
            navigationDecision(NavigationKind.Private, openPublicLinks = true),
        )
    }

    @Test
    fun publicLinksFollowTheSetting() {
        assertEquals(
            NavigationDecision.Block,
            navigationDecision(NavigationKind.Public, openPublicLinks = false),
        )
        assertEquals(
            NavigationDecision.OpenSystemBrowser,
            navigationDecision(NavigationKind.Public, openPublicLinks = true),
        )
    }

    @Test
    fun blockedLinksNeverOpen() {
        assertEquals(
            NavigationDecision.Block,
            navigationDecision(NavigationKind.Blocked, openPublicLinks = false),
        )
        assertEquals(
            NavigationDecision.Block,
            navigationDecision(NavigationKind.Blocked, openPublicLinks = true),
        )
    }
}
