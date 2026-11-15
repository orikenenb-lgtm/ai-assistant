package ai.noa.bridge.app.platform

import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.ReplySender
import ai.noa.bridge.core.SendOutcome
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Hands ONE reply to WhatsApp through WhatsApp's own notification Reply action (RemoteInput),
 * exactly like typing into the reply field of the notification shade.
 *
 * Only the core coordinator calls this, and only with a validated, single-use approval.
 *
 * Semantics:
 * - No live handle → [SendOutcome.FAILED_NO_ACTION] (nothing is sent).
 * - The handle is removed BEFORE the attempt, so a handle can never be used twice.
 * - `PendingIntent.send()` returned → [SendOutcome.ATTEMPTED]. Android gives no delivery
 *   confirmation; WhatsApp may still drop the message (e.g. no network). Never "delivered".
 * - [PendingIntent.CanceledException] → [SendOutcome.FAILED_CANCELED]; anything else → [SendOutcome.UNKNOWN].
 * - Never retries.
 *
 * Android 14+ options: we deliberately pass NO ActivityOptions/BroadcastOptions. A reply
 * PendingIntent is a broadcast/service intent in WhatsApp; it must not start an activity, so we do
 * not opt in to granting our background-activity-launch privilege
 * (MODE_BACKGROUND_ACTIVITY_START_ALLOWED). If WhatsApp's intent tried to open an activity, the
 * system would block that launch while the send itself still happens.
 */
class RemoteInputReplySender(
    private val context: Context,
    private val registry: ReplyActionRegistry,
    private val mainDispatcher: CoroutineDispatcher = Dispatchers.Main,
) : ReplySender {

    override suspend fun send(conversationKey: ConversationKey, text: String): SendOutcome {
        if (text.isBlank()) {
            // The core validates the text before calling; never send an empty reply.
            SafeLog.w(SafeLog.Event.SEND_NO_ACTION)
            return SendOutcome.FAILED_NO_ACTION
        }
        val handle = registry.take(conversationKey)
        if (handle == null) {
            SafeLog.w(SafeLog.Event.SEND_NO_ACTION)
            return SendOutcome.FAILED_NO_ACTION
        }
        val freeForm = handle.remoteInputs.filter { it.allowFreeFormInput }
        if (freeForm.isEmpty()) {
            SafeLog.w(SafeLog.Event.SEND_NO_ACTION)
            return SendOutcome.FAILED_NO_ACTION
        }
        // An immutable PendingIntent silently drops our fill-in extras: WhatsApp would receive an
        // empty reply. Refuse instead of sending something other than what the user approved.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && handle.pendingIntent.isImmutable) {
            SafeLog.w(SafeLog.Event.SEND_IMMUTABLE_PENDING_INTENT)
            return SendOutcome.FAILED_NO_ACTION
        }

        return withContext(mainDispatcher) {
            try {
                val fillIn = buildFillInIntent(freeForm.toTypedArray(), text)
                handle.pendingIntent.send(context, 0, fillIn)
                SafeLog.i(SafeLog.Event.SEND_ATTEMPTED)
                SendOutcome.ATTEMPTED
            } catch (e: PendingIntent.CanceledException) {
                SafeLog.w(SafeLog.Event.SEND_CANCELED)
                SendOutcome.FAILED_CANCELED
            } catch (e: Exception) {
                SafeLog.e(SafeLog.Event.SEND_UNKNOWN, e)
                SendOutcome.UNKNOWN
            }
        }
    }

    companion object {
        /** The fill-in intent a notification shade would produce for typed text. */
        fun buildFillInIntent(remoteInputs: Array<RemoteInput>, text: String): Intent {
            val intent = Intent()
            val results = Bundle()
            remoteInputs.forEach { results.putCharSequence(it.resultKey, text) }
            RemoteInput.addResultsToIntent(remoteInputs, intent, results)
            RemoteInput.setResultsSource(intent, RemoteInput.SOURCE_FREE_FORM_INPUT)
            return intent
        }
    }
}
