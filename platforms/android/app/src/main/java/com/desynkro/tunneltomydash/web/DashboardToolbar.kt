package com.desynkro.tunneltomydash.web

import android.content.Context
import android.graphics.Color
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.TextView

class DashboardToolbar(
    context: Context,
    profileName: String,
    private val onBack: () -> Unit,
    private val onReload: () -> Unit,
    private val onHome: () -> Unit,
    private val onProfiles: () -> Unit,
    private val onLock: () -> Unit,
    private val onStop: () -> Unit,
    private val allowLock: Boolean = true,
) : LinearLayout(context) {
    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Color.argb(0xF2, 0, 0, 0))
        setPadding(dp(4), 0, dp(4), 0)

        addView(toolbarButton("‹", onBack))
        addView(toolbarButton("⟳", onReload))
        addView(toolbarButton("⌂", onHome))

        addView(
            TextView(context).apply {
                text = profileName
                textSize = 14f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER_VERTICAL
                ellipsize = TextUtils.TruncateAt.END
                isSingleLine = true
                setPadding(dp(8), 0, dp(8), 0)
            },
            LayoutParams(0, LayoutParams.MATCH_PARENT, 1f),
        )

        val overflow = toolbarButton("⋮") {}
        overflow.setOnClickListener { anchor ->
            val popup = PopupMenu(context, anchor)
            popup.menu.add("Profiles")
            if (allowLock) {
                popup.menu.add("Lock")
            }
            popup.menu.add("Stop")
            popup.setOnMenuItemClickListener { item ->
                when (item.title.toString()) {
                    "Profiles" -> onProfiles()
                    "Lock" -> onLock()
                    "Stop" -> onStop()
                }
                true
            }
            popup.show()
        }
        addView(overflow)
    }

    private fun toolbarButton(label: String, action: () -> Unit): TextView =
        TextView(context).apply {
            text = label
            textSize = 20f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(12), 0, dp(12), 0)
            isClickable = true
            setOnClickListener { action() }
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
