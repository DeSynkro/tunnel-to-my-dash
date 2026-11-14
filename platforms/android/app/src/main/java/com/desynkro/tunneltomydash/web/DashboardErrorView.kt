package com.desynkro.tunneltomydash.web

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class DashboardErrorView(
    context: Context,
    onRetry: () -> Unit,
    onProfiles: () -> Unit,
) : LinearLayout(context) {
    private val titleView = TextView(context).apply {
        textSize = 20f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
    }
    private val messageView = TextView(context).apply {
        textSize = 14f
        setTextColor(Color.rgb(176, 176, 176))
        gravity = Gravity.CENTER
        setPadding(0, dp(8), 0, dp(16))
    }

    init {
        orientation = VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.argb(0xF2, 0, 0, 0))
        setPadding(dp(24), dp(24), dp(24), dp(24))
        isClickable = true

        addView(titleView)
        addView(messageView)
        addView(
            Button(context).apply {
                text = "Try again"
                setOnClickListener { onRetry() }
            },
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT),
        )
        addView(
            Button(context).apply {
                text = "Main menu"
                setOnClickListener { onProfiles() }
            },
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT),
        )
        visibility = GONE
    }

    fun show(title: String, message: String) {
        titleView.text = title
        messageView.text = message
        visibility = VISIBLE
        bringToFront()
    }

    fun hide() {
        visibility = GONE
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
