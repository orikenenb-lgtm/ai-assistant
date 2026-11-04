package com.disciplineos.app.enforcement

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
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
import com.disciplineos.app.ui.navigation.Routes
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Builds every notification of the enforcement layer. The persistent notification is ALWAYS visible while the
 * service runs and states plainly what the app is doing. Nothing here is hidden or silent-by-trick.
 */
@Singleton
class EnforcementNotifier @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")

    /** Channels are created by the data layer at app start; this only fills the gap if that has not happened yet. */
    fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(NotificationChannels.ENFORCEMENT) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    NotificationChannels.ENFORCEMENT,
                    context.getString(R.string.enf_channel_enforcement_name),
                    NotificationManager.IMPORTANCE_LOW,
                ).apply { description = context.getString(R.string.enf_channel_enforcement_desc) },
            )
        }
        if (nm.getNotificationChannel(NotificationChannels.REMINDERS) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    NotificationChannels.REMINDERS,
                    context.getString(R.string.enf_channel_alert_name),
                    NotificationManager.IMPORTANCE_HIGH,
                ),
            )
        }
    }

    fun openAppIntent(route: String? = null): PendingIntent {
        val launch = appLaunchIntent(context, route)
        return PendingIntent.getActivity(
            context, REQUEST_OPEN_APP + (route?.hashCode() ?: 0) % 1000, launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    fun statusText(status: EnforcementStatus): String = when (status) {
        is EnforcementStatus.MandatoryPending -> context.resources.getQuantityString(
            R.plurals.enf_notif_mandatory_pending, status.count, status.count,
        )
        EnforcementStatus.FocusActive -> context.getString(R.string.enf_notif_focus_active)
        is EnforcementStatus.BypassActive -> status.until?.let {
            context.getString(R.string.enf_notif_bypass_until, format(it))
        } ?: context.getString(R.string.enf_notif_bypass)
        is EnforcementStatus.RecoveryActive -> status.until?.let {
            context.getString(R.string.enf_notif_recovery_until, format(it))
        } ?: context.getString(R.string.enf_notif_recovery)
        EnforcementStatus.AllOpen -> context.getString(R.string.enf_notif_all_open)
        EnforcementStatus.MissingUsageAccess -> context.getString(R.string.enf_notif_missing_usage)
        EnforcementStatus.MissingOverlay -> context.getString(R.string.enf_notif_missing_overlay)
        EnforcementStatus.Starting -> context.getString(R.string.enf_notif_starting)
    }

    fun buildOngoing(status: EnforcementStatus): Notification {
        ensureChannels()
        val text = statusText(status)
        val degraded = status is EnforcementStatus.MissingOverlay || status is EnforcementStatus.MissingUsageAccess
        return NotificationCompat.Builder(context, NotificationChannels.ENFORCEMENT)
            .setSmallIcon(R.drawable.ic_enforcement_shield)
            .setContentTitle(context.getString(R.string.enf_notif_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(openAppIntent(if (degraded) ROUTE_PERMISSIONS else ROUTE_BLOCKER))
            .build()
    }

    fun updateOngoing(status: EnforcementStatus) = notifySafe(NotificationChannels.ID_ENFORCEMENT, buildOngoing(status))

    /**
     * Fallback when the block screen cannot be started (overlay permission missing on Android 10+):
     * a high-priority, dismissible heads-up that opens the block screen when tapped (a user tap may start activities).
     */
    fun postBlockAlert(appLabel: String?, blockedPackage: String) {
        ensureChannels()
        val tapIntent = Intent(context, BlockActivity::class.java)
            .putExtra(BlockActivity.EXTRA_PACKAGE, blockedPackage)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pi = PendingIntent.getActivity(
            context, REQUEST_BLOCK_ALERT, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val text = if (appLabel.isNullOrBlank()) {
            context.getString(R.string.enf_alert_text_generic)
        } else {
            context.getString(R.string.enf_alert_text_app, appLabel)
        }
        val notification = NotificationCompat.Builder(context, NotificationChannels.REMINDERS)
            .setSmallIcon(R.drawable.ic_enforcement_shield)
            .setContentTitle(context.getString(R.string.block_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text + "\n" + context.getString(R.string.enf_alert_overlay_hint)))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000)
            .setContentIntent(pi)
            .addAction(0, context.getString(R.string.enf_alert_fix_permission), openAppIntent(ROUTE_PERMISSIONS))
            .build()
        notifySafe(ID_BLOCK_ALERT, notification)
    }

    fun cancelBlockAlert() = NotificationManagerCompat.from(context).cancel(ID_BLOCK_ALERT)

    /** Shown when Android refused to start the foreground service from the background. Tapping opens the app, which re-syncs. */
    fun postStartPrompt() {
        ensureChannels()
        val notification = NotificationCompat.Builder(context, NotificationChannels.ENFORCEMENT)
            .setSmallIcon(R.drawable.ic_enforcement_shield)
            .setContentTitle(context.getString(R.string.enf_start_prompt_title))
            .setContentText(context.getString(R.string.enf_start_prompt_text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ROUTE_BLOCKER))
            .build()
        notifySafe(ID_START_PROMPT, notification)
    }

    fun cancelStartPrompt() = NotificationManagerCompat.from(context).cancel(ID_START_PROMPT)

    @SuppressLint("MissingPermission")
    private fun notifySafe(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return // Without the permission, the FGS notification still appears in the Task Manager / FGS list.
        }
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (_: SecurityException) {
            // Permission revoked concurrently; nothing to do.
        }
    }

    private fun format(instant: Instant): String = timeFormat.format(instant.atZone(ZoneId.systemDefault()))

    companion object {
        /** Ids outside the ranges reserved in NotificationChannels (1001-1003, 200_000+). */
        const val ID_BLOCK_ALERT = 1010
        const val ID_START_PROMPT = 1011

        private const val REQUEST_OPEN_APP = 7100
        private const val REQUEST_BLOCK_ALERT = 7200

        /** Optional hint for MainActivity (owned by the UI-core agent); ignored if not handled. */
        const val EXTRA_OPEN_ROUTE = "com.disciplineos.app.extra.OPEN_ROUTE"
        const val ROUTE_BLOCKER = Routes.BLOCKER
        const val ROUTE_PERMISSIONS = Routes.PERMISSIONS
        const val ROUTE_DASHBOARD = Routes.DASHBOARD

        /** Launch intent for our own launcher activity, without a compile-time dependency on MainActivity. */
        fun appLaunchIntent(context: Context, route: String? = null): Intent {
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(context.packageName)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            if (route != null) intent.putExtra(EXTRA_OPEN_ROUTE, route)
            return intent
        }
    }
}
