package com.desynkro.tunneltomydash.security

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class BiometricUnlock(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    fun isAvailable(): Boolean =
        BiometricManager.from(appContext).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG,
        ) == BiometricManager.BIOMETRIC_SUCCESS

    fun isEnabled(): Boolean =
        prefs.contains(KEY_CIPHERTEXT) &&
            prefs.contains(KEY_IV) &&
            runCatching { keyStore.containsAlias(KEY_ALIAS) }.getOrDefault(false)

    fun enable(password: String) {
        disable()
        val key = getOrCreateKey()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ciphertext = cipher.doFinal(password.toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString(KEY_CIPHERTEXT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
    }

    fun disable() {
        prefs.edit().clear().apply()
        runCatching { keyStore.deleteEntry(KEY_ALIAS) }
    }

    fun prompt(
        activity: FragmentActivity,
        onSuccess: (String) -> Unit,
        onError: (Int, String) -> Unit,
    ) {
        val ciphertext = prefs.getString(KEY_CIPHERTEXT, null)
        val iv = prefs.getString(KEY_IV, null)
        if (ciphertext == null || iv == null || !runCatching { keyStore.containsAlias(KEY_ALIAS) }.getOrDefault(false)) {
            onError(-1, "Fingerprint unlock is not set up")
            return
        }

        val cipher = try {
            Cipher.getInstance(TRANSFORMATION).apply {
                init(
                    Cipher.DECRYPT_MODE,
                    getKey(),
                    GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
                )
            }
        } catch (invalidated: KeyPermanentlyInvalidatedException) {
            disable()
            onError(-1, "Fingerprint data changed. Enable fingerprint unlock again.")
            return
        } catch (caught: Throwable) {
            onError(-1, caught.message ?: "Fingerprint unlock is unavailable")
            return
        }

        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    result: BiometricPrompt.AuthenticationResult,
                ) {
                    try {
                        val plaintext = result.cryptoObject?.cipher?.doFinal(
                            Base64.decode(ciphertext, Base64.NO_WRAP),
                        ) ?: error("missing cipher")
                        onSuccess(String(plaintext, Charsets.UTF_8))
                    } catch (caught: Throwable) {
                        onError(-1, caught.message ?: "Could not unlock the vault")
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    onError(errorCode, errString.toString())
                }

                override fun onAuthenticationFailed() {
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock Tunnel to My Dash")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText("Use password")
            .build()
        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    private fun getOrCreateKey(): SecretKey {
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let {
            return it.secretKey
        }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        val builder = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(
                0,
                KeyProperties.AUTH_BIOMETRIC_STRONG,
            )
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }

        generator.init(builder.build())
        return generator.generateKey()
    }

    private fun getKey(): SecretKey =
        (keyStore.getEntry(KEY_ALIAS, null) as KeyStore.SecretKeyEntry).secretKey

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "ttmd_biometric_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val PREFS = "biometric_unlock"
        private const val KEY_CIPHERTEXT = "ciphertext"
        private const val KEY_IV = "iv"
    }
}
