package ai.noa.bridge.app.platform

import ai.noa.bridge.app.MainActivity
import ai.noa.bridge.app.R
import ai.noa.bridge.core.Draft
import ai.noa.bridge.core.DraftState
import android.Manifest
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

/**
 * Our OWN notification ("drafts" channel) telling the user a draft waits for approval.
 *
 * - Private version: "טיוטה מוכנה לאישור" / "תשובה עבור <sender>". Public (lock-screen) version
 *   has no names: "טיוטה חדשה ממתינה".
 * - Tap opens MainActivity (immutable PendingIntent) with [EXTRA_DRAFT_ID].
 * - There are deliberately NO actions: approval and sending happen only inside the app.
 * - Skips silently when POST_NOTIFICATIONS is not granted (Android 13+) or notifications are off.
 * - Never touches other apps' notifications; [cancel] only cancels our own.
 */
class DraftNotifier(private val context: Context) {

    private val manager = NotificationManagerCompat.from(context)
    private val notified = HashMap<String, Int>() // draftId -> revision already announced

    fun ensureChannel() {
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = CHANNEL_DESCRIPTION
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            setShowBadge(true)
        }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    fun canPost(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return manager.areNotificationsEnabled()
    }

    /** Diff the current drafts against what we already announced. Call on every drafts emission. */
    @Synchronized
    fun onDrafts(drafts: List<Draft>) {
        val awaiting = drafts.filter { it.state == DraftState.AWAITING_APPROVAL }.associateBy { it.id }
        // Withdraw our notification for drafts that are no longer waiting.
        (notified.keys - awaiting.keys).toList().forEach { id ->
            notified.remove(id)
            cancel(id)
        }
        awaiting.values.forEach { draft ->
            if (notified.containsKey(draft.id)) return@forEach // announce once per draft, not per edit
            notified[draft.id] = draft.revision
            post(draft)
        }
    }

    private fun post(draft: Draft) {
        if (!canPost()) {
            SafeLog.i(SafeLog.Event.DRAFT_NOTIFICATION_SKIPPED_NO_PERMISSION)
            return
        }
        ensureChannel()
        val publicVersion = baseBuilder(draft.id)
            .setContentTitle(PUBLIC_TITLE)
            .build()
        val notification = baseBuilder(draft.id)
            .setContentTitle(TITLE)
            .setContentText("תשובה עבור ${draft.senderDisplayName}")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .build()
        try {
            manager.notify(TAG, notificationId(draft.id), notification)
            SafeLog.i(SafeLog.Event.DRAFT_NOTIFICATION_POSTED)
        } catch (e: SecurityException) {
            SafeLog.e(SafeLog.Event.DRAFT_NOTIFICATION_SKIPPED_NO_PERMISSION, e)
        }
    }

    private fun baseBuilder(draftId: String): NotificationCompat.Builder =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(draftId))

    private fun openAppIntent(draftId: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_DRAFT_ID, draftId)
        return PendingIntent.getActivity(
            context,
            notificationId(draftId),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    fun cancel(draftId: String) {
        manager.cancel(TAG, notificationId(draftId))
    }

    @Synchronized
    fun cancelAll() {
        notified.keys.toList().forEach { cancel(it) }
        notified.clear()
    }

    private fun notificationId(draftId: String): Int = draftId.hashCode()

    companion object {
        const val CHANNEL_ID = "drafts"
        const val EXTRA_DRAFT_ID = "ai.noa.bridge.extra.DRAFT_ID"
        private const val TAG = "noa_draft"
        private const val CHANNEL_NAME = "טיוטות לאישור"
        private const val CHANNEL_DESCRIPTION = "התראה כשטיוטת תשובה מוכנה לאישור באפליקציה"
        const val TITLE = "טיוטה מוכנה לאישור"
        const val PUBLIC_TITLE = "טיוטה חדשה ממתינה"
    }
}
