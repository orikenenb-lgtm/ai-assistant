package ai.noa.bridge.app.platform

import android.service.notification.NotificationListenerService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.lang.ref.WeakReference

/**
 * Process-wide listener state: "is our NotificationListenerService connected" plus a weak
 * reference to the connected instance so the reply sender can check that a notification is
 * still active (read-only: only getActiveNotifications() is ever called through it).
 */
object ListenerState {
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    @Volatile
    private var service: WeakReference<NotificationListenerService>? = null

    internal fun attach(listener: NotificationListenerService) {
        service = WeakReference(listener)
        _connected.value = true
    }

    internal fun detach() {
        service = null
        _connected.value = false
    }

    internal fun setConnected(connected: Boolean) {
        _connected.value = connected
    }

    /** Keys of the currently active notifications, or null when the listener is not connected. */
    fun activeNotificationKeys(): Set<String>? {
        val listener = service?.get() ?: return null
        if (!_connected.value) return null
        return try {
            listener.activeNotifications.orEmpty().mapNotNull { it?.key }.toSet()
        } catch (e: RuntimeException) {
            // SecurityException when access was revoked between the check and the call.
            SafeLog.e(SafeLog.Event.NOTIFICATION_MAP_FAILED, e)
            null
        }
    }
}
