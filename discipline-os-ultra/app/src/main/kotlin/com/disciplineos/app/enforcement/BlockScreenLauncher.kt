package com.disciplineos.app.enforcement

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import com.disciplineos.app.enforcement.ui.PermissionChecks
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Starts the block screen for a package that the policy decided to Block. Shared by the polling service and the
 * optional accessibility service.
 *
 * - Debounced: at most one launch per package per 2s.
 * - Never launches over protected packages (re-checked here as a last line of defence).
 * - If Android does not allow us to start an activity from the background (Android 10+ without
 *   "display over other apps"), posts a high-priority notification instead and reports degraded health.
 */
@Singleton
class BlockScreenLauncher @Inject constructor(
    @ApplicationContext private val context: Context,
    private val engine: EnforcementEngine,
    private val notifier: EnforcementNotifier,
) {
    private val debouncer = LaunchDebouncer(windowMillis = 2_000L)
    private val alertDebouncer = LaunchDebouncer(windowMillis = 60_000L)

    /**
     * @param fromAccessibility accessibility services are allowed to start activities without the overlay grant.
     * @return true if the block screen (or fallback alert) was shown.
     */
    fun launch(packageName: String, fromAccessibility: Boolean = false): Boolean {
        if (engine.isProtected(packageName)) return false
        val now = SystemClock.elapsedRealtime()
        val allowed = synchronized(debouncer) { debouncer.shouldLaunch(packageName, now) }
        if (!allowed) return false

        val canStart = fromAccessibility || PermissionChecks.canLaunchBlockScreen(context)
        engine.reportHealth { it.copy(overlayMissing = !canStart) }
        if (!canStart) {
            val alertAllowed = synchronized(alertDebouncer) { alertDebouncer.shouldLaunch(packageName, now) }
            if (alertAllowed) notifier.postBlockAlert(labelOf(packageName), packageName)
            return alertAllowed
        }
        val intent = Intent(context, BlockActivity::class.java)
            .putExtra(BlockActivity.EXTRA_PACKAGE, packageName)
            .addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_NO_ANIMATION,
            )
        return try {
            context.startActivity(intent)
            notifier.cancelBlockAlert()
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: SecurityException) {
            notifier.postBlockAlert(labelOf(packageName), packageName)
            false
        }
    }

    fun resetDebounce() = synchronized(debouncer) { debouncer.reset() }

    private fun labelOf(packageName: String): String? = try {
        val pm = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }
}
