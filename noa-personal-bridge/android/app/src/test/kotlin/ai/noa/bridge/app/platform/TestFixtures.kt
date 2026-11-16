package ai.noa.bridge.app.platform

import ai.noa.bridge.core.Approval
import ai.noa.bridge.core.BridgeCoordinator
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.Draft
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.NotificationSnapshot
import android.content.Context
import android.content.Intent
import android.app.PendingIntent
import android.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Reversible, obviously-not-plaintext cipher for tests (AndroidKeyStore is absent on Robolectric). */
class FakeCipher : SecretCipher {
    var destroyed = false
    override fun encrypt(plaintext: String): String =
        "fake:" + Base64.encodeToString(plaintext.reversed().toByteArray(Charsets.UTF_8), Base64.NO_WRAP)

    override fun decrypt(encoded: String): String? {
        if (destroyed || !encoded.startsWith("fake:")) return null
        return String(Base64.decode(encoded.removePrefix("fake:"), Base64.NO_WRAP), Charsets.UTF_8).reversed()
    }

    override fun destroyKey() {
        destroyed = true
    }
}

fun key(c: Char): ConversationKey = ConversationKey(c.toString().repeat(64))

const val TEST_REPLY_ACTION = "ai.noa.bridge.test.REPLY"

fun mutablePendingIntent(context: Context, requestCode: Int = 0): PendingIntent = PendingIntent.getBroadcast(
    context,
    requestCode,
    Intent(TEST_REPLY_ACTION).setPackage(context.packageName),
    PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
)

fun snapshot(
    notificationKey: String = "0|com.whatsapp|1|tag|10",
    tag: String? = "tag",
    isGroupSummary: Boolean = false,
    isGroupFlag: Boolean? = false,
    isOngoing: Boolean = false,
    postTime: Long = 1_000L,
) = NotificationSnapshot(
    packageName = "com.whatsapp",
    notificationKey = notificationKey,
    tag = tag,
    postTimeMillis = postTime,
    isGroupSummary = isGroupSummary,
    isGroupConversationFlag = isGroupFlag,
    conversationTitle = null,
    shortcutId = null,
    title = "T",
    messages = emptyList(),
    hasReplyAction = true,
    isOngoing = isOngoing,
    category = "msg",
)

fun draft(id: String, key: ConversationKey, state: DraftState, sender: String = "דנה") = Draft(
    id = id,
    conversationKey = key,
    senderDisplayName = sender,
    sourceMessages = emptyList(),
    proposedText = "טיוטה",
    editedText = null,
    state = state,
    revision = 1,
    createdAtMillis = 0,
    updatedAtMillis = 0,
)

/** Records every call; never sends anything. */
class FakeCoordinator(initial: List<Draft> = emptyList()) : BridgeCoordinator {
    val draftsFlow = MutableStateFlow(initial)
    override val drafts: StateFlow<List<Draft>> = draftsFlow
    val calls = mutableListOf<String>()
    var lastSettings: BridgeSettings? = null
    var sendResult = DraftState.SEND_ATTEMPTED

    override fun onNotification(snapshot: NotificationSnapshot) { calls += "onNotification" }
    override fun onNotificationRemoved(conversationKey: ConversationKey) { calls += "onNotificationRemoved" }
    val seeded = mutableListOf<NotificationSnapshot>()
    override fun seedSeen(snapshots: List<NotificationSnapshot>) { calls += "seedSeen"; seeded += snapshots }
    override fun updateSettings(settings: BridgeSettings) { calls += "updateSettings"; lastSettings = settings }
    override fun edit(draftId: String, newText: String) { calls += "edit:$draftId" }
    override fun cancel(draftId: String) { calls += "cancel:$draftId" }
    override fun approve(draftId: String, finalText: String): Approval? { calls += "approve:$draftId"; return null }
    override suspend fun sendApproved(approval: Approval): DraftState { calls += "sendApproved:${approval.draftId}"; return sendResult }
    override fun emergencyStop() { calls += "emergencyStop" }
    override fun clearAll() { calls += "clearAll" }
}

fun approval(draftId: String, key: ConversationKey) = Approval(
    token = "t",
    draftId = draftId,
    revision = 1,
    conversationKey = key,
    textSha256 = "0".repeat(64),
    issuedAtMillis = 0,
    expiresAtMillis = Long.MAX_VALUE,
)
