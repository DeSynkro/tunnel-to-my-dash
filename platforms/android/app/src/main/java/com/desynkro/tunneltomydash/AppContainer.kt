package com.desynkro.tunneltomydash

import android.content.Context
import com.desynkro.tunneltomydash.data.VaultGateway
import com.desynkro.tunneltomydash.data.VaultRepository
import com.desynkro.tunneltomydash.service.CoreGateway
import com.desynkro.tunneltomydash.service.MobileCore
import com.desynkro.tunneltomydash.security.BiometricUnlock
import com.desynkro.tunneltomydash.service.TunnelController
import java.io.File

class AppContainer(context: Context) {
    private val appContext = context.applicationContext
    val vaultPath: String = File(appContext.filesDir, "vault").absolutePath
    val repository: VaultGateway = VaultRepository(vaultPath)
    val core: CoreGateway = MobileCore()
    val tunnel: TunnelController = TunnelController(core)
    val biometric: BiometricUnlock = BiometricUnlock(appContext)
}
