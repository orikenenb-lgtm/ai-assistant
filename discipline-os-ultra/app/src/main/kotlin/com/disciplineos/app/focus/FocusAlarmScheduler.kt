package com.disciplineos.app.focus

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Schedules a single wake-up at the current phase's end so the timer advances (and the notification updates)
 * even when the app is in the background or the device is dozing.
 *
 * Correctness never depends on alarm precision: [com.disciplineos.core.domain.focus.FocusSessionManager] derives
 * everything from timestamps, so an inexact alarm only delays the "phase finished" transition slightly.
 */
@Singleton
class FocusAlarmScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val alarmManager: AlarmManager? = context.getSystemService(AlarmManager::class.java)

    fun schedule(at: Instant) {
        val am = alarmManager ?: return
        val pendingIntent = phaseEndIntent()
        val triggerAt = at.toEpochMilli()
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        if (canExact) {
            try {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
                return
            } catch (_: SecurityException) {
                // Exact-alarm access was revoked between the check and the call: fall through to inexact.
            }
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
    }

    fun cancel() {
        alarmManager?.cancel(phaseEndIntent())
    }

    private fun phaseEndIntent(): PendingIntent = PendingIntent.getBroadcast(
        context,
        REQUEST_PHASE_END,
        Intent(context, FocusAlarmReceiver::class.java).setAction(FocusAlarmReceiver.ACTION_PHASE_END),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private companion object {
        const val REQUEST_PHASE_END = 7_100
    }
}
