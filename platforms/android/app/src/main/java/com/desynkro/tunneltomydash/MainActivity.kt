package com.desynkro.tunneltomydash

import android.graphics.Color
import android.os.Bundle
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import androidx.compose.ui.platform.ComposeView
import androidx.core.view.WindowCompat
import com.desynkro.tunneltomydash.ui.AppRoot
import com.desynkro.tunneltomydash.ui.AppViewModel
import com.desynkro.tunneltomydash.ui.TtmdTheme

class MainActivity : ComponentActivity() {
    private val viewModel: AppViewModel by viewModels {
        AppViewModel.factory((application as TtmdApplication).container.repository)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }
        val composeView = ComposeView(this).apply {
            setContent {
                TtmdTheme {
                    AppRoot(viewModel)
                }
            }
        }
        root.addView(
            composeView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(root)
    }
}
