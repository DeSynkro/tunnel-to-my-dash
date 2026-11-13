package com.desynkro.tunneltomydash.web

import android.app.Activity
import android.app.AlertDialog
import android.text.InputType
import android.view.WindowManager
import android.webkit.HttpAuthHandler
import android.widget.EditText
import android.widget.LinearLayout

class BasicAuthController(private val activity: Activity) {
    private data class Pending(
        val handler: HttpAuthHandler,
        val key: String,
        val host: String,
        val realm: String?,
    )

    private val credentials = mutableMapOf<String, Pair<String, String>>()
    private val pending = mutableListOf<Pending>()
    private var currentDialog: AlertDialog? = null

    fun handle(handler: HttpAuthHandler, key: String, host: String, realm: String?) {
        credentials[key]?.let { (username, password) ->
            handler.proceed(username, password)
            return
        }
        pending.add(Pending(handler, key, host, realm))
        showNext()
    }

    fun clear() {
        currentDialog?.dismiss()
        currentDialog = null
        pending.forEach { it.handler.cancel() }
        pending.clear()
        credentials.clear()
    }

    private fun showNext() {
        if (currentDialog?.isShowing == true) {
            return
        }
        val request = pending.firstOrNull() ?: return

        val padding = (20 * activity.resources.displayMetrics.density).toInt()
        val layout = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding / 2, padding, 0)
        }
        val username = EditText(activity).apply {
            hint = "Username"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_EDIT_TEXT
            setSingleLine()
        }
        val password = EditText(activity).apply {
            hint = "Password"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine()
        }
        layout.addView(username)
        layout.addView(password)

        val dialog = AlertDialog.Builder(activity)
            .setTitle("Sign in to ${request.host}")
            .setMessage(
                request.realm?.takeIf { it.isNotBlank() }
                    ?: "This site requires a username and password.",
            )
            .setView(layout)
            .setPositiveButton("Sign in", null)
            .setNegativeButton("Cancel") { _, _ -> cancel(request.key) }
            .setOnCancelListener { cancel(request.key) }
            .create()

        dialog.setOnShowListener {
            username.requestFocus()
            dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val user = username.text.toString()
                val pass = password.text.toString()
                if (user.isBlank()) {
                    username.error = "Enter the username"
                    return@setOnClickListener
                }
                credentials[request.key] = user to pass
                currentDialog = null
                dialog.dismiss()
                val matching = pending.filter { it.key == request.key }
                pending.removeAll { it.key == request.key }
                matching.forEach { it.handler.proceed(user, pass) }
                showNext()
            }
        }

        currentDialog = dialog
        dialog.show()
    }

    private fun cancel(key: String) {
        currentDialog?.dismiss()
        currentDialog = null
        val matching = pending.filter { it.key == key }
        pending.removeAll { it.key == key }
        matching.forEach { it.handler.cancel() }
        showNext()
    }
}
