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

    /** Pair with the bridge backend using a one-time code. */
    suspend fun pair(baseUrl: String, pairingCode: String): PairingResult
    /** Revokes the device token on the server (best effort) and forgets it locally. */
    suspend fun disconnect()
    /** Deletes drafts, exclusions, settings and tokens stored on this device. */
    suspend fun wipeLocalData()

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

sealed interface PairingResult {
    data object Success : PairingResult
    data class Failure(val messageHebrew: String) : PairingResult
}
