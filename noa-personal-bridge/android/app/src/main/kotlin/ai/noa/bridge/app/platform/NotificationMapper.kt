package ai.noa.bridge.app.platform

import ai.noa.bridge.core.ContentVisibility
import ai.noa.bridge.core.NotificationSnapshot
import ai.noa.bridge.core.SnapshotMessage
import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat

/** The live reply action of a notification. Only ever held in memory (see [ReplyActionRegistry]). */
class ReplyAction(
    val pendingIntent: PendingIntent,
    /** Only the free-form RemoteInputs of the chosen action (choice-only / data-only inputs are dropped). */
    val remoteInputs: Array<RemoteInput>,
    val isSemanticReply: Boolean,
)

/** Result of mapping: the platform-neutral snapshot for the core plus the reply action (if any). */
class MappedNotification(
    val snapshot: NotificationSnapshot,
    val replyAction: ReplyAction?,
    /**
     * Android 15+ sensitive-content redaction (or a content-hiding placeholder) detected: the
     * notification may still carry a Reply action, but we must never reply through it.
     */
    val isLikelyRedacted: Boolean = false,
)

/**
 * StatusBarNotification → core [NotificationSnapshot]. Pure read-only: it never modifies,
 * cancels or snoozes the source notification.
 *
 * The [map] overload that takes a [Notification] plus metadata exists so the logic can be tested
 * with notifications built by NotificationCompat.Builder (Robolectric), without a StatusBarNotification.
 */
object NotificationMapper {

    fun map(sbn: StatusBarNotification): MappedNotification = map(
        notification = sbn.notification,
        packageName = sbn.packageName,
        notificationKey = sbn.key,
        tag = sbn.tag,
        postTimeMillis = sbn.postTime,
    )

    fun map(
        notification: Notification,
        packageName: String,
        notificationKey: String,
        tag: String?,
        postTimeMillis: Long,
    ): MappedNotification {
        val extras = notification.extras
        val style: NotificationCompat.MessagingStyle? = try {
            NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
        } catch (e: RuntimeException) {
            // Malformed extras (e.g. a Parcelable we cannot read). Fall back to plain extras.
            SafeLog.e(SafeLog.Event.NOTIFICATION_MAP_FAILED, e)
            null
        }

        val title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val messages: List<SnapshotMessage> = if (style != null) {
            styleMessages(style)
        } else {
            fallbackMessages(notification, title, postTimeMillis)
        }

        // Read the raw extra: MessagingStyle.isGroupConversation() silently defaults to false when
        // the extra is absent, but the core must be able to tell "absent" from "false" (fail closed).
        val isGroupFlag: Boolean? = if (extras?.containsKey(NotificationCompat.EXTRA_IS_GROUP_CONVERSATION) == true) {
            extras.getBoolean(NotificationCompat.EXTRA_IS_GROUP_CONVERSATION)
        } else {
            null
        }

        val conversationTitle = style?.conversationTitle?.toString()
            ?: extras?.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()

        val replyAction = findReplyAction(notification)
        val flags = notification.flags

        val snapshot = NotificationSnapshot(
            packageName = packageName,
            notificationKey = notificationKey,
            tag = tag,
            postTimeMillis = postTimeMillis,
            isGroupSummary = flags and Notification.FLAG_GROUP_SUMMARY != 0,
            isGroupConversationFlag = isGroupFlag,
            conversationTitle = conversationTitle,
            shortcutId = notification.shortcutId,
            title = title,
            messages = messages,
            hasReplyAction = replyAction != null,
            isOngoing = flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_FOREGROUND_SERVICE) != 0,
            category = notification.category,
        )
        val text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        return MappedNotification(snapshot, replyAction, isLikelyRedacted(snapshot, text))
    }

    /**
     * Redacted WhatsApp notifications (Android 15+ "sensitive notification" redaction for
     * untrusted listeners) carry the app label as title and a system notice as text. Uses the
     * core's single detector ([ContentVisibility], shared with the core filter) on the mapped
     * snapshot plus the raw EXTRA_TEXT (which can differ from the MessagingStyle lines).
     */
    fun isLikelyRedacted(snapshot: NotificationSnapshot, text: String?): Boolean =
        ContentVisibility.isRedactedSnapshot(snapshot) ||
            (text != null && ContentVisibility.isSensitiveRedactionNotice(text))

    private fun styleMessages(style: NotificationCompat.MessagingStyle): List<SnapshotMessage> {
        val user = style.user
        return style.messages.map { message ->
            val person = message.person
            val isFromSelf = person == null ||
                (person.key != null && person.key == user.key) ||
                (person.name != null && user.name != null && person.name.toString() == user.name.toString())
            SnapshotMessage(
                sender = (person?.name ?: user.name)?.toString(),
                text = message.text?.toString(),
                timestampMillis = message.timestamp,
                isFromSelf = isFromSelf,
            )
        }
    }

    private fun fallbackMessages(notification: Notification, title: String?, postTimeMillis: Long): List<SnapshotMessage> {
        val text = notification.extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: return emptyList()
        val timestamp = notification.`when`.takeIf { it > 0 } ?: postTimeMillis
        return listOf(SnapshotMessage(sender = title, text = text, timestampMillis = timestamp, isFromSelf = false))
    }

    /**
     * The action we would reply through: an action whose RemoteInput allows free-form text.
     * Prefers [Notification.Action.SEMANTIC_ACTION_REPLY]; ignores system-generated contextual actions.
     */
    fun findReplyAction(notification: Notification): ReplyAction? {
        val candidates = notification.actions.orEmpty().mapNotNull { action ->
            if (action == null || action.isContextual) return@mapNotNull null
            val pendingIntent = action.actionIntent ?: return@mapNotNull null
            val freeForm = action.remoteInputs.orEmpty().filter { it.allowFreeFormInput }
            if (freeForm.isEmpty()) return@mapNotNull null
            ReplyAction(
                pendingIntent = pendingIntent,
                remoteInputs = freeForm.toTypedArray(),
                isSemanticReply = action.semanticAction == Notification.Action.SEMANTIC_ACTION_REPLY,
            )
        }
        return candidates.firstOrNull { it.isSemanticReply } ?: candidates.firstOrNull()
    }
}
