package com.disciplineos.app.focus

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.disciplineos.app.R
import com.disciplineos.app.notifications.NotificationChannels
import com.disciplineos.app.ui.focus.FocusFormat
import com.disciplineos.core.model.FocusPhase
import com.disciplineos.core.model.FocusState
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Ongoing, silent notification while a focus session is active. The countdown is rendered by the system
 * chronometer (no per-second updates from the app → no wakeups, battery friendly).
 */
@Singleton
class FocusNotifier @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val manager = NotificationManagerCompat.from(context)

    /** Shows/updates the notification for an active (non-IDLE) [state]. [remainingMillis] is used while paused. */
    @SuppressLint("MissingPermission") // Checked explicitly by canPost() right before notify().
    fun show(state: FocusState, remainingMillis: Long) {
        if (state.phase == FocusPhase.IDLE) {
            cancel()
            return
        }
        if (!canPost()) return

        val phaseLabel = context.getString(
            when (state.phase) {
                FocusPhase.WORK -> R.string.feat_focus_phase_work
                FocusPhase.SHORT_BREAK -> R.string.feat_focus_phase_short_break
                FocusPhase.LONG_BREAK -> R.string.feat_focus_phase_long_break
                FocusPhase.IDLE -> R.string.feat_focus_phase_idle
            },
        )

        val builder = NotificationCompat.Builder(context, NotificationChannels.FOCUS)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(phaseLabel)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppIntent())

        val endsAt = state.phaseEndsAt
        if (state.paused || endsAt == null) {
            builder
                .setContentText(context.getString(R.string.feat_focus_notif_paused, FocusFormat.clock(remainingMillis)))
                .setShowWhen(false)
                .setUsesChronometer(false)
                .addAction(0, context.getString(R.string.feat_focus_resume), actionIntent(FocusAlarmReceiver.ACTION_RESUME, REQ_RESUME))
        } else {
            builder
                .setContentText(context.getString(R.string.feat_focus_notif_running))
                .setWhen(endsAt.toEpochMilli())
                .setShowWhen(true)
                .setUsesChronometer(true)
                // minSdk 26 ≥ 24, so the count-down chronometer is always supported.
                .setChronometerCountDown(true)
                .addAction(0, context.getString(R.string.feat_focus_pause), actionIntent(FocusAlarmReceiver.ACTION_PAUSE, REQ_PAUSE))
        }
        builder.addAction(0, context.getString(R.string.feat_focus_stop), actionIntent(FocusAlarmReceiver.ACTION_STOP, REQ_STOP))

        try {
            manager.notify(NotificationChannels.ID_FOCUS, builder.build())
        } catch (_: SecurityException) {
            // Permission revoked concurrently; the timer keeps working without the notification.
        }
    }

    fun cancel() {
        manager.cancel(NotificationChannels.ID_FOCUS)
    }

    private fun canPost(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return manager.areNotificationsEnabled()
    }

    private fun openAppIntent(): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        return PendingIntent.getActivity(
            context,
            REQ_OPEN,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun actionIntent(action: String, requestCode: Int): PendingIntent = PendingIntent.getBroadcast(
        context,
        requestCode,
        Intent(context, FocusAlarmReceiver::class.java).setAction(action),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private companion object {
        const val REQ_OPEN = 7_200
        const val REQ_PAUSE = 7_201
        const val REQ_RESUME = 7_202
        const val REQ_STOP = 7_203
    }
}
