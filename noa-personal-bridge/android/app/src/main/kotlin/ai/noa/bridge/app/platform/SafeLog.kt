package ai.noa.bridge.app.platform

import android.util.Log

/**
 * The ONLY logger the platform layer uses. By construction it cannot log content: it accepts
 * an [Event] enum, an optional integer (count / HTTP status / reason code) and, for errors, the
 * exception's class name — never `Throwable.message`, never notification text, sender names,
 * phone numbers, URLs or tokens.
 */
internal object SafeLog {
    private const val TAG = "NoaBridge"

    enum class Event {
        LISTENER_CONNECTED,
        LISTENER_DISCONNECTED,
        LISTENER_REBIND_REQUESTED,
        NOTIFICATION_MAPPED,
        NOTIFICATION_MAP_FAILED,
        NOTIFICATION_NO_KEY,
        NOTIFICATION_REMOVED,
        REPLY_HANDLE_STORED,
        REPLY_HANDLE_REMOVED,
        REPLY_HANDLE_EVICTED,
        SEND_ATTEMPTED,
        SEND_NO_ACTION,
        SEND_IMMUTABLE_PENDING_INTENT,
        SEND_CANCELED,
        SEND_UNKNOWN,
        SEND_REFUSED_LOCKED,
        SEND_REFUSED_DISABLED,
        API_HTTP_ERROR,
        API_IO_ERROR,
        API_BAD_RESPONSE,
        API_REFUSED_URL,
        SECURE_STORE_DECRYPT_FAILED,
        DRAFT_NOTIFICATION_POSTED,
        DRAFT_NOTIFICATION_SKIPPED_NO_PERMISSION,
        COROUTINE_FAILURE,
        CONTROLLER_FAILURE,
    }

    fun i(event: Event, code: Int? = null) {
        safely { Log.i(TAG, format(event, code)) }
    }

    fun w(event: Event, code: Int? = null) {
        safely { Log.w(TAG, format(event, code)) }
    }

    /** Logs only the exception's class name. The message and stack trace may contain content. */
    fun e(event: Event, error: Throwable) {
        safely { Log.w(TAG, "${event.name} type=${error.javaClass.simpleName}") }
    }

    private fun format(event: Event, code: Int?): String = if (code == null) event.name else "${event.name} code=$code"

    private inline fun safely(block: () -> Unit) {
        try {
            block()
        } catch (_: RuntimeException) {
            // android.util.Log is not mocked in plain JVM tests; logging must never break the caller.
        }
    }
}
