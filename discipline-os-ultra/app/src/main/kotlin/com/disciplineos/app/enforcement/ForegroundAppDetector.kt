package com.disciplineos.app.enforcement

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import com.disciplineos.app.enforcement.ui.PermissionChecks
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Answers "which app is in the foreground?" from UsageStatsManager events. This does NOT block anything by itself;
 * it only observes. Requires the user-granted "Usage access" special permission; returns null without it.
 * Package names never leave the device and are never logged.
 */
@Singleton
class ForegroundAppDetector @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val usm: UsageStatsManager? =
        context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager

    private val lock = Any()
    private var lastKnown: String? = null
    private var lastQueryAt: Long = 0L

    fun hasPermission(): Boolean = PermissionChecks.hasUsageAccess(context)

    /** Current foreground package, or null if unknown / no permission. Call off the main thread. */
    fun currentForegroundPackage(nowMillis: Long = System.currentTimeMillis()): String? {
        val manager = usm ?: return null
        if (!hasPermission()) {
            synchronized(lock) { lastKnown = null; lastQueryAt = 0L }
            return null
        }
        synchronized(lock) {
            // First query (or after a long gap such as screen-off) looks further back so an app opened
            // minutes ago is still detected; steady-state polling only scans the last ~10s.
            val gap = nowMillis - lastQueryAt
            val window = if (lastQueryAt == 0L || gap > STEADY_WINDOW_MS) COLD_WINDOW_MS else STEADY_WINDOW_MS
            val events = try {
                readEvents(manager, nowMillis - window, nowMillis)
            } catch (_: SecurityException) {
                lastKnown = null
                return null
            } catch (_: IllegalStateException) {
                // Thrown on some devices while the user is locked (direct boot). Keep previous answer.
                return lastKnown
            }
            val initial = if (window == COLD_WINDOW_MS) null else lastKnown
            lastKnown = reduceForegroundPackage(events, initial)
            lastQueryAt = nowMillis
            return lastKnown
        }
    }

    /** Forget cached state (e.g. after screen-off, where the next answer must come from fresh events). */
    fun reset() {
        synchronized(lock) { lastKnown = null; lastQueryAt = 0L }
    }

    private fun readEvents(manager: UsageStatsManager, begin: Long, end: Long): List<UsageEventSample> {
        val result = ArrayList<UsageEventSample>()
        val usageEvents = manager.queryEvents(begin, end) ?: return result
        val event = UsageEvents.Event()
        while (usageEvents.hasNextEvent()) {
            usageEvents.getNextEvent(event)
            val type = classify(event.eventType)
            if (type == ForegroundEventType.OTHER) continue
            val pkg = event.packageName ?: continue
            result += UsageEventSample(event.timeStamp, pkg, type)
        }
        return result
    }

    companion object {
        const val STEADY_WINDOW_MS = 10_000L
        const val COLD_WINDOW_MS = 10 * 60_000L

        // Raw values are stable platform constants; named constants are used where the SDK level allows.
        private const val EVENT_SCREEN_NON_INTERACTIVE = 16 // UsageEvents.Event.SCREEN_NON_INTERACTIVE (API 28)
        private const val EVENT_KEYGUARD_SHOWN = 17 // UsageEvents.Event.KEYGUARD_SHOWN (API 28)
        private const val EVENT_DEVICE_SHUTDOWN = 26 // UsageEvents.Event.DEVICE_SHUTDOWN (API 29)

        @Suppress("DEPRECATION")
        fun classify(eventType: Int): ForegroundEventType {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                return when (eventType) {
                    UsageEvents.Event.ACTIVITY_RESUMED -> ForegroundEventType.FOREGROUND
                    // ACTIVITY_STOPPED is deliberately ignored: inside one app "A stopped" arrives after
                    // "B resumed" and would wrongly clear the foreground package.
                    UsageEvents.Event.ACTIVITY_PAUSED -> ForegroundEventType.BACKGROUND
                    UsageEvents.Event.SCREEN_NON_INTERACTIVE,
                    UsageEvents.Event.KEYGUARD_SHOWN,
                    UsageEvents.Event.DEVICE_SHUTDOWN -> ForegroundEventType.SCREEN_OFF
                    else -> ForegroundEventType.OTHER
                }
            }
            return when (eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> ForegroundEventType.FOREGROUND
                UsageEvents.Event.MOVE_TO_BACKGROUND -> ForegroundEventType.BACKGROUND
                EVENT_SCREEN_NON_INTERACTIVE, EVENT_KEYGUARD_SHOWN, EVENT_DEVICE_SHUTDOWN ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ForegroundEventType.SCREEN_OFF else ForegroundEventType.OTHER
                else -> ForegroundEventType.OTHER
            }
        }
    }
}
