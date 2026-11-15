package ai.noa.bridge.app.platform

import ai.noa.bridge.app.BridgeApplication
import android.content.ComponentName
import android.os.Process
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Reads WhatsApp notifications after the user granted Notification Access. Read-only by design:
 * this class never calls cancelNotification / snoozeNotification / setNotificationsShown or any
 * other method that changes another app's notifications.
 *
 * No foreground service, no wake locks, no polling, no network here — the system binds this
 * service and delivers callbacks on the main thread; we map cheaply and hand off to the core.
 */
class NoaNotificationListenerService : NotificationListenerService() {

    /**
     * The ingestor, or null when the platform graph cannot be built right now (e.g. a keystore
     * failure while loading credentials). The listener must never crash the process — a crash here
     * would repeat on every rebind (crash loop).
     */
    private fun ingestorOrNull(): NotificationIngestor? = try {
        (application as BridgeApplication).platform.ingestor
    } catch (e: RuntimeException) {
        SafeLog.e(SafeLog.Event.CONTROLLER_FAILURE, e)
        null
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        ListenerState.attach(this)
        SafeLog.i(SafeLog.Event.LISTENER_CONNECTED)
        // Rebuild reply handles for chats already showing (handles are lost on process death).
        // This does NOT create drafts for old messages.
        try {
            val ingestor = ingestorOrNull() ?: return
            val active = activeNotifications.orEmpty()
                .filter { it != null && ingestor.accepts(it.packageName, it.user == Process.myUserHandle()) }
                .map { NotificationMapper.map(it) }
            ingestor.rebuildFrom(active)
        } catch (e: RuntimeException) {
            SafeLog.e(SafeLog.Event.NOTIFICATION_MAP_FAILED, e)
        }
    }

    override fun onDestroy() {
        ListenerState.detach()
        super.onDestroy()
    }

    override fun onListenerDisconnected() {
        ListenerState.detach()
        SafeLog.i(SafeLog.Event.LISTENER_DISCONNECTED)
        super.onListenerDisconnected()
        // Ask the system to bind us again (public API; it only takes effect while access is granted).
        try {
            requestRebind(ComponentName(this, NoaNotificationListenerService::class.java))
            SafeLog.i(SafeLog.Event.LISTENER_REBIND_REQUESTED)
        } catch (e: RuntimeException) {
            SafeLog.e(SafeLog.Event.LISTENER_DISCONNECTED, e)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?, rankingMap: RankingMap?) {
        if (sbn == null) return
        val ingestor = ingestorOrNull() ?: return
        try {
            if (!ingestor.accepts(sbn.packageName, sbn.user == Process.myUserHandle())) return
            ingestor.onPosted(NotificationMapper.map(sbn))
            SafeLog.i(SafeLog.Event.NOTIFICATION_MAPPED)
        } catch (e: RuntimeException) {
            SafeLog.e(SafeLog.Event.NOTIFICATION_MAP_FAILED, e)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?, rankingMap: RankingMap?, reason: Int) {
        if (sbn == null) return
        val ingestor = ingestorOrNull() ?: return
        try {
            if (!ingestor.accepts(sbn.packageName, sbn.user == Process.myUserHandle())) return
            ingestor.onRemoved(NotificationMapper.map(sbn), reason)
        } catch (e: RuntimeException) {
            SafeLog.e(SafeLog.Event.NOTIFICATION_MAP_FAILED, e)
        }
    }
}
