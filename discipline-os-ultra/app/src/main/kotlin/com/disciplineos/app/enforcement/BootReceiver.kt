package com.disciplineos.app.enforcement

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject

/**
 * Restores enforcement after reboot / app update, and re-syncs after time or time-zone changes.
 * Occurrence materialization on time changes is the data layer's worker; here we only (re)start or stop the service.
 * These broadcasts are exempt from Android 12+ background FGS-start restrictions.
 */
@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {

    @Inject lateinit var controller: EnforcementController

    // Hilt's bytecode transform injects fields at the start of onReceive; do not call super.onReceive.
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_TIME_CHANGED,
            -> Unit
            else -> return
        }
        val pending = goAsync()
        receiverScope.launch {
            try {
                withTimeoutOrNull(8_000L) { controller.syncNow() }
                // Keep following config changes while the process lives.
                controller.sync()
            } catch (_: Exception) {
                // Never crash at boot.
            } finally {
                pending.finish()
            }
        }
    }

    private companion object {
        val receiverScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }
}
