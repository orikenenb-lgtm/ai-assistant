package ai.noa.bridge.app.platform

import ai.noa.bridge.core.ChatKind
import ai.noa.bridge.core.ContentVisibility
import ai.noa.bridge.core.ConversationFilter
import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.ConversationKeys
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
 * - The cached handle is taken (removed) BEFORE anything else, so a handle can never be used twice.
 *   It is only used to know WHICH notification to look at; it is never sent through.
 * - Send-time re-validation, all on the main thread in ONE turn, as the very last step before
 *   `PendingIntent.send()` (so no listener callback or UI tap can run in between):
 *   1. the LIVE notification for the handle's notification key is read from the connected
 *      listener (no longer showing / listener not connected → [SendOutcome.FAILED_NO_ACTION]);
 *   2. it is re-mapped with [NotificationMapper]: it must not be redacted, must still classify as
 *      a private chat, and its [ConversationKeys.derive] key must equal the approved conversation
 *      key — otherwise the slot now belongs to another chat → [SendOutcome.FAILED_NO_ACTION];
 *   3. the reply action and RemoteInputs of THAT live notification are used (not the cached ones);
 *      no free-form input or an immutable PendingIntent → [SendOutcome.FAILED_NO_ACTION];
 *   4. [sendGate] (emergency stop, pause, sending toggle, device lock — supplied by the controller)
 *      is re-checked; closed → [SendOutcome.FAILED_NO_ACTION] without sending.
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
    /** True only while sending is allowed right now (not stopped/paused, toggle on, device unlocked). */
    private val sendGate: () -> Boolean,
    private val mainDispatcher: CoroutineDispatcher = Dispatchers.Main,
    /**
     * The live notification with this key, freshly mapped; null when it is no longer showing or the
     * listener is not connected. Production: the listener's active notification → [NotificationMapper].
     */
    private val liveNotification: (notificationKey: String) -> MappedNotification? = Companion::liveFromListener,
) : ReplySender {

    private val filter = ConversationFilter.create()

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

        return withContext(mainDispatcher) {
            // Last step before the send, in the same main-thread turn: re-validate against the live
            // notification and the controller's gate.
            val action = liveReplyAction(conversationKey, handle.notificationKey)
                ?: return@withContext SendOutcome.FAILED_NO_ACTION
            if (!gateOpen()) {
                SafeLog.w(SafeLog.Event.SEND_REFUSED_GATE)
                return@withContext SendOutcome.FAILED_NO_ACTION
            }
            try {
                val fillIn = buildFillInIntent(action.remoteInputs, text)
                action.pendingIntent.send(context, 0, fillIn)
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

    private fun gateOpen(): Boolean = try {
        sendGate()
    } catch (e: RuntimeException) {
        SafeLog.e(SafeLog.Event.SEND_REFUSED_GATE, e)
        false
    }

    /** The reply action of the LIVE notification [notificationKey], if it still belongs to [approvedKey]. */
    private fun liveReplyAction(approvedKey: ConversationKey, notificationKey: String): ReplyAction? {
        val live = try {
            liveNotification(notificationKey)
        } catch (e: RuntimeException) {
            SafeLog.e(SafeLog.Event.NOTIFICATION_MAP_FAILED, e)
            null
        }
        if (live == null || live.snapshot.notificationKey != notificationKey) {
            // Withdrawn notification: the chat was handled elsewhere (or the handle is stale).
            SafeLog.w(SafeLog.Event.SEND_NO_ACTION)
            return null
        }
        val snapshot = live.snapshot
        if (live.isLikelyRedacted || ContentVisibility.isRedactedSnapshot(snapshot) ||
            filter.classify(snapshot) != ChatKind.PRIVATE
        ) {
            SafeLog.w(SafeLog.Event.SEND_CONVERSATION_MISMATCH)
            return null
        }
        if (ConversationKeys.derive(snapshot) != approvedKey) {
            // The notification slot now shows a different conversation: never reply through it.
            SafeLog.w(SafeLog.Event.SEND_CONVERSATION_MISMATCH)
            return null
        }
        val action = live.replyAction
        val freeForm = action?.remoteInputs.orEmpty().filter { it.allowFreeFormInput }
        if (action == null || freeForm.isEmpty()) {
            SafeLog.w(SafeLog.Event.SEND_NO_ACTION)
            return null
        }
        // An immutable PendingIntent silently drops our fill-in extras: WhatsApp would receive an
        // empty reply. Refuse instead of sending something other than what the user approved.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && action.pendingIntent.isImmutable) {
            SafeLog.w(SafeLog.Event.SEND_IMMUTABLE_PENDING_INTENT)
            return null
        }
        return ReplyAction(action.pendingIntent, freeForm.toTypedArray(), action.isSemanticReply)
    }

    companion object {
        /** Production lookup: the listener's live notification with that key, re-mapped. */
        fun liveFromListener(notificationKey: String): MappedNotification? =
            ListenerState.activeNotification(notificationKey)?.let(NotificationMapper::map)

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
