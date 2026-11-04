package com.disciplineos.app.notifications

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.disciplineos.app.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Builds and posts task-reminder and daily-summary notifications.
 * - Checks POST_NOTIFICATIONS (API 33+) and the system-level switch before every post; silently no-ops otherwise.
 * - Task titles appear only in the private notification body; the lock-screen public version is generic.
 * - All PendingIntents are explicit and FLAG_IMMUTABLE.
 */
@Singleton
class ReminderNotifier @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    fun canPostNotifications(): Boolean {
        val granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        return granted && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun showTaskReminder(occurrenceId: Long, title: String, mandatory: Boolean, quickCompleteAllowed: Boolean) {
        val text = context.getString(if (mandatory) R.string.notif_reminder_text_mandatory else R.string.notif_reminder_text_optional)
        val builder = NotificationCompat.Builder(context, NotificationChannels.REMINDERS)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(R.string.notif_reminder_public_title))
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
        if (quickCompleteAllowed) {
            builder.addAction(0, context.getString(R.string.notif_action_complete), actionIntent(TaskActionReceiver.ACTION_COMPLETE, occurrenceId))
        }
        builder.addAction(0, context.getString(R.string.notif_action_snooze_30), actionIntent(TaskActionReceiver.ACTION_SNOOZE, occurrenceId))
        post(reminderNotificationId(occurrenceId), builder.build())
    }

    /** Replaces a reminder when a quick action could not be applied (e.g. proof required, snooze limit). */
    fun showActionNeedsApp(occurrenceId: Long) {
        val notification = NotificationCompat.Builder(context, NotificationChannels.REMINDERS)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(context.getString(R.string.notif_action_needs_app_title))
            .setContentText(context.getString(R.string.notif_action_needs_app_text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
            .build()
        post(reminderNotificationId(occurrenceId), notification)
    }

    fun cancelReminder(occurrenceId: Long) {
        NotificationManagerCompat.from(context).cancel(reminderNotificationId(occurrenceId))
    }

    fun showDailySummary(completed: Int, total: Int, mandatoryOpen: Int) {
        val title = context.getString(
            if (mandatoryOpen == 0) R.string.notif_summary_title_cleared else R.string.notif_summary_title_open,
        )
        val text = if (mandatoryOpen == 0) {
            context.getString(R.string.notif_summary_text_cleared, completed, total)
        } else {
            context.getString(R.string.notif_summary_text_open, completed, total, mandatoryOpen)
        }
        val notification = NotificationCompat.Builder(context, NotificationChannels.COACH)
            .setSmallIcon(android.R.drawable.ic_menu_agenda)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(R.string.notif_summary_public_title))
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
            .build()
        post(NotificationChannels.ID_DAILY_SUMMARY, notification)
    }

    // Permission is verified by canPostNotifications() immediately before notify().
    @SuppressLint("MissingPermission")
    private fun post(id: Int, notification: Notification) {
        if (!canPostNotifications()) return
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (e: SecurityException) {
            // Permission revoked between the check and the call; nothing else to do.
        }
    }

    private fun publicVersion(titleRes: Int): Notification =
        NotificationCompat.Builder(context, NotificationChannels.REMINDERS)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(context.getString(titleRes))
            .build()

    private fun openAppIntent(): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        } ?: return null
        return PendingIntent.getActivity(context, REQUEST_OPEN_APP, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun actionIntent(action: String, occurrenceId: Long): PendingIntent {
        val intent = Intent(context, TaskActionReceiver::class.java)
            .setAction(action)
            .putExtra(TaskActionReceiver.EXTRA_OCCURRENCE_ID, occurrenceId)
        // Distinct request code per (occurrence, action) so extras of different notifications never collide.
        val requestCode = (occurrenceId.mod(100_000L).toInt() * 2) + if (action == TaskActionReceiver.ACTION_COMPLETE) 0 else 1
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    companion object {
        private const val REQUEST_OPEN_APP = 900_001

        fun reminderNotificationId(occurrenceId: Long): Int =
            NotificationChannels.ID_REMINDER_BASE + occurrenceId.mod(100_000L).toInt()
    }
}
