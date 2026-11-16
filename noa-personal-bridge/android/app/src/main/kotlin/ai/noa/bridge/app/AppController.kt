package ai.noa.bridge.app

import ai.noa.bridge.core.Approval
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.Draft
import ai.noa.bridge.core.DraftState
import kotlinx.coroutines.flow.StateFlow

/**
 * CONTRACT FILE (Agent 04). The single boundary between the Compose UI (ui/ package, Agent 11)
 * and the platform layer (platform/ package, Agents 08/09/24). The UI never touches Android
 * services, the network or the core coordinator directly — only this interface.
 */
interface AppController {
    val status: StateFlow<BridgeStatus>
    val settings: StateFlow<BridgeSettings>
    val drafts: StateFlow<List<Draft>>
    /** Local-only exclusion entries with the display name the user saw when excluding. */
    val exclusions: StateFlow<List<ExclusionEntry>>

    fun setPaused(paused: Boolean)
    fun emergencyStop()
    /** Clears emergency stop (requires the user to re-confirm in the UI). */
    fun resumeAfterEmergencyStop()
    fun setCloudConsent(given: Boolean)
    /** Experimental reply path. Only effective when BuildConfig.REPLY_PATH_COMPILED_IN. */
    fun setSendingEnabled(enabled: Boolean)

    fun excludeConversationOf(draftId: String)
    fun removeExclusion(conversationKeyValue: String)

    fun editDraft(draftId: String, newText: String)
    fun cancelDraft(draftId: String)
    /** Returns an approval for exactly [finalText], or null if the draft can't be approved now. */
    fun approveDraft(draftId: String, finalText: String): Approval?
    /** Performs the single send attempt for a valid approval. Requires an unlocked device. */
    suspend fun sendApproved(approval: Approval): DraftState

    /**
     * D-020: opens the draft's chat INSIDE WhatsApp with the STORED text of the draft
     * ([Draft.finalText]) pre-typed; the user sends it with WhatsApp's own send button. This is not
     * our send: it works with the experimental sending toggle off and never changes the draft's
     * state. Only for drafts in AWAITING_APPROVAL / APPROVED and never while emergency-stopped.
     *
     * Falls back to copying the text (marked sensitive) and opening the chat through WhatsApp's own
     * notification, or only copying when the chat cannot be found. Call it from a foreground
     * activity (it starts another app's activity).
     */
    fun openInWhatsApp(draftId: String): OpenInWhatsAppResult

    /**
     * Pair with the bridge backend using a one-time code. [spkiPin] (optional, `sha256/<base64>` or
     * the bare base64) pins the server's public key for every later call; null/blank = system CAs.
     */
    suspend fun pair(baseUrl: String, pairingCode: String, spkiPin: String? = null): PairingResult
    /**
     * Revokes the device token on the server (best effort) and forgets it locally. Reports honestly
     * whether the server confirmed the revocation; when it did not, the token may still be valid on
     * the server and `status.lastErrorHebrew` explains how to revoke it there.
     */
    suspend fun disconnect(): ServerRevokeResult
    /**
     * Deletes drafts, exclusions, settings and tokens stored on this device. When paired, first
     * tries (best effort) to revoke the token on the server, and reports the result like [disconnect].
     */
    suspend fun wipeLocalData(): ServerRevokeResult

    /** Opens the system screen where the user grants notification access. */
    fun openNotificationAccessSettings()
    /** Re-reads permission state (call from onResume). */
    fun refreshPermissions()
}

data class BridgeStatus(
    val notificationAccessGranted: Boolean = false,
    val postNotificationsGranted: Boolean = false,
    val listenerConnected: Boolean = false,
    val paired: Boolean = false,
    val backendBaseUrl: String? = null,
    /** Last backend health result: null = unknown. */
    val backendReachable: Boolean? = null,
    val lastErrorHebrew: String? = null,
    val deviceLocked: Boolean = false,
)

data class ExclusionEntry(val conversationKeyValue: String, val displayName: String)

/** Whether the server confirmed that the device token is revoked. */
enum class ServerRevokeResult {
    /** The server answered 2xx to the revoke call. */
    CONFIRMED,
    /** No answer / an error: the token may still be valid on the server. */
    NOT_CONFIRMED,
    /** There was no token to revoke. */
    NOT_PAIRED,
}

/** Outcome of [AppController.openInWhatsApp]. The UI shows the Hebrew text from strings.xml. */
enum class OpenInWhatsAppResult {
    /** WhatsApp opened on the chat with the text pre-typed (the user still presses Send there). */
    OPENED_WITH_TEXT,
    /** The text was copied and the chat was opened through WhatsApp's notification: "הטקסט הועתק — הדבק בשיחה". */
    OPENED_CHAT_TEXT_COPIED,
    /** The chat could not be opened; the text was copied: "לא נמצאה השיחה ב-WhatsApp — הטקסט הועתק". */
    CHAT_NOT_FOUND_TEXT_COPIED,
    /** Refused: the draft is gone, has no text, or is not waiting for approval. Nothing happened. */
    NOT_AVAILABLE,
    /** Refused: emergency stop is on. Nothing happened. */
    EMERGENCY_STOPPED,
    ;

    /** True when nothing was opened (the caller should show the draft in the app instead). */
    val isFailure: Boolean get() = this != OPENED_WITH_TEXT && this != OPENED_CHAT_TEXT_COPIED
}

sealed interface PairingResult {
    data object Success : PairingResult
    data class Failure(val messageHebrew: String) : PairingResult
}
