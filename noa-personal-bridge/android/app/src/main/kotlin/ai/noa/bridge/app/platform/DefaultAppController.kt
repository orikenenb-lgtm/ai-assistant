package ai.noa.bridge.app.platform

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.ExclusionEntry
import ai.noa.bridge.app.PairingResult
import ai.noa.bridge.core.Approval
import ai.noa.bridge.core.BridgeCoordinator
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.Draft
import ai.noa.bridge.core.DraftEngineClient
import ai.noa.bridge.core.DraftResult
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.ReplySender
import android.Manifest
import android.app.KeyguardManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Production [AppController]: wires the core [BridgeCoordinator] to the platform pieces and owns
 * persisted settings, exclusions and credentials.
 *
 * Safety rules enforced here (in addition to the core's own checks):
 * - [sendApproved] never reaches the coordinator while the device is locked, when the reply path
 *   is not compiled in, or when the experimental send toggle is off.
 * - Nothing is sent to the backend without cloud consent (the engine wrapper short-circuits).
 * - Emergency stop also turns the experimental send toggle off and drops every reply handle.
 */
class DefaultAppController(
    private val context: Context,
    private val scope: CoroutineScope,
    private val secureStore: SecureStore,
    private val settingsStore: SettingsStore,
    private val registry: ReplyActionRegistry,
    private val notifier: DraftNotifier?,
    replySender: ReplySender,
    apiClientFactory: (credentials: () -> ApiCredentials?, onUnauthorized: () -> Unit) -> BridgeApiClient,
    coordinatorFactory: (engine: DraftEngineClient, sender: ReplySender, settings: BridgeSettings) -> BridgeCoordinator,
    private val replyPathCompiledIn: Boolean,
    private val allowDebugCleartext: Boolean,
    private val debounceMillis: Long,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val isDeviceLocked: () -> Boolean = defaultLockCheck(context),
    private val deviceName: String = Build.MODEL ?: "Android",
) : AppController {

    @Volatile
    private var credentialsCache: ApiCredentials? = loadCredentials()

    private val api: BridgeApiClient = apiClientFactory({ credentialsCache }) {
        setError(BridgeApiClient.MSG_UNAUTHORIZED)
    }

    private val _exclusions = MutableStateFlow(secureStore.exclusions())
    override val exclusions: StateFlow<List<ExclusionEntry>> = _exclusions.asStateFlow()

    private val _settings = MutableStateFlow(
        sanitize(settingsStore.load(excludedKeys(_exclusions.value), debounceMillis)),
    )
    override val settings: StateFlow<BridgeSettings> = _settings.asStateFlow()

    private val _status = MutableStateFlow(BridgeStatus())
    override val status: StateFlow<BridgeStatus> = _status.asStateFlow()

    /** Consent gate + status reporting around the real backend client. */
    private val engine = DraftEngineClient { request ->
        if (!_settings.value.cloudConsentGiven) {
            DraftResult.Failure(MSG_NO_CONSENT, retryable = false)
        } else {
            val result = api.requestDraft(request)
            when (result) {
                is DraftResult.Success -> _status.update { it.copy(backendReachable = true, lastErrorHebrew = null) }
                is DraftResult.Failure -> _status.update {
                    it.copy(
                        backendReachable = if (result.reason == BridgeApiClient.MSG_UNAVAILABLE) false else it.backendReachable,
                        lastErrorHebrew = result.reason,
                    )
                }
            }
            result
        }
    }

    val coordinator: BridgeCoordinator = coordinatorFactory(engine, replySender, _settings.value)

    override val drafts: StateFlow<List<Draft>> = coordinator.drafts

    init {
        refreshPermissions()
        scope.launch { ListenerState.connected.collect { c -> _status.update { it.copy(listenerConnected = c) } } }
        if (notifier != null) scope.launch { coordinator.drafts.collect { notifier.onDrafts(it) } }
        credentialsCache?.let { creds -> scope.launch { checkHealth(creds.baseUrl) } }
    }

    // ---- settings -------------------------------------------------------------------------

    override fun setPaused(paused: Boolean) = updateSettings { it.copy(paused = paused) }

    override fun emergencyStop() {
        coordinator.emergencyStop()
        registry.clear()
        updateSettings { it.copy(emergencyStopped = true, sendingEnabled = false) }
    }

    override fun resumeAfterEmergencyStop() = updateSettings { it.copy(emergencyStopped = false) }

    override fun setCloudConsent(given: Boolean) = updateSettings { it.copy(cloudConsentGiven = given) }

    override fun setSendingEnabled(enabled: Boolean) = updateSettings { it.copy(sendingEnabled = enabled) }

    override fun excludeConversationOf(draftId: String) {
        val draft = coordinator.drafts.value.firstOrNull { it.id == draftId } ?: return
        val key = draft.conversationKey
        val updated = _exclusions.value.filterNot { it.conversationKeyValue == key.value } +
            ExclusionEntry(key.value, draft.senderDisplayName)
        persistExclusions(updated)
        // Cancel every open draft of that conversation, not only the one the user looked at.
        coordinator.drafts.value
            .filter { it.conversationKey == key && it.state !in NOT_CANCELLABLE }
            .forEach { coordinator.cancel(it.id) }
        registry.remove(key)
    }

    override fun removeExclusion(conversationKeyValue: String) {
        persistExclusions(_exclusions.value.filterNot { it.conversationKeyValue == conversationKeyValue })
    }

    private fun persistExclusions(entries: List<ExclusionEntry>) {
        secureStore.setExclusions(entries)
        _exclusions.value = entries
        updateSettings { it.copy(excludedConversations = excludedKeys(entries)) }
    }

    private fun updateSettings(transform: (BridgeSettings) -> BridgeSettings) {
        val next = sanitize(transform(_settings.value))
        _settings.value = next
        settingsStore.save(next)
        coordinator.updateSettings(next)
    }

    private fun sanitize(s: BridgeSettings): BridgeSettings =
        s.copy(sendingEnabled = s.sendingEnabled && replyPathCompiledIn, debounceMillis = debounceMillis)

    // ---- drafts ---------------------------------------------------------------------------

    override fun editDraft(draftId: String, newText: String) = coordinator.edit(draftId, newText)

    override fun cancelDraft(draftId: String) = coordinator.cancel(draftId)

    override fun approveDraft(draftId: String, finalText: String): Approval? = coordinator.approve(draftId, finalText)

    /**
     * The send gate the reply sender re-checks on the main thread immediately before
     * `PendingIntent.send` (after the core's own checks): false when emergency-stopped, paused,
     * the experimental send toggle is off (or not compiled in), or the device is locked.
     */
    fun canSendNow(): Boolean {
        val s = _settings.value
        if (!replyPathCompiledIn || !s.sendingEnabled || s.paused || s.emergencyStopped) return false
        val locked = try {
            isDeviceLocked()
        } catch (e: RuntimeException) {
            SafeLog.e(SafeLog.Event.CONTROLLER_FAILURE, e)
            true
        }
        return !locked
    }

    override suspend fun sendApproved(approval: Approval): DraftState {
        val current = coordinator.drafts.value.firstOrNull { it.id == approval.draftId }?.state ?: DraftState.EXPIRED
        if (!replyPathCompiledIn || !_settings.value.sendingEnabled) {
            SafeLog.w(SafeLog.Event.SEND_REFUSED_DISABLED)
            setError(MSG_SENDING_DISABLED)
            return current
        }
        val locked = isDeviceLocked()
        _status.update { it.copy(deviceLocked = locked) }
        if (locked) {
            SafeLog.w(SafeLog.Event.SEND_REFUSED_LOCKED)
            setError(MSG_LOCKED)
            return current
        }
        return coordinator.sendApproved(approval)
    }

    // ---- backend --------------------------------------------------------------------------

    override suspend fun pair(baseUrl: String, pairingCode: String): PairingResult {
        val url = BridgeApiClient.validateBaseUrl(baseUrl, allowDebugCleartext)
            ?: return PairingResult.Failure(BridgeApiClient.MSG_BAD_URL)
        val code = BridgeApiClient.normalizePairingCode(pairingCode)
            ?: return PairingResult.Failure(BridgeApiClient.MSG_BAD_CODE_FORMAT)
        val canonicalUrl = url.toString()
        return when (val outcome = api.pair(canonicalUrl, code, deviceName)) {
            is PairOutcome.Failure -> {
                setError(outcome.messageHebrew)
                PairingResult.Failure(outcome.messageHebrew)
            }
            is PairOutcome.Success -> {
                withContext(ioDispatcher) {
                    secureStore.baseUrl = canonicalUrl
                    secureStore.deviceId = outcome.deviceId
                    secureStore.deviceToken = outcome.deviceToken
                }
                credentialsCache = ApiCredentials(canonicalUrl, outcome.deviceToken)
                _status.update { it.copy(paired = true, backendBaseUrl = canonicalUrl, lastErrorHebrew = null) }
                scope.launch { checkHealth(canonicalUrl) }
                PairingResult.Success
            }
        }
    }

    override suspend fun disconnect() {
        if (credentialsCache != null) {
            withTimeoutOrNull(REVOKE_TIMEOUT_MILLIS) { api.revoke() }
        }
        credentialsCache = null
        withContext(ioDispatcher) { secureStore.clearCredentials() }
        _status.update { it.copy(paired = false, backendReachable = null) }
    }

    override suspend fun wipeLocalData() {
        coordinator.clearAll()
        registry.clear()
        notifier?.cancelAll()
        credentialsCache = null
        withContext(ioDispatcher) {
            secureStore.wipeAll()
            settingsStore.wipeAll()
        }
        _exclusions.value = emptyList()
        val defaults = sanitize(BridgeSettings())
        _settings.value = defaults
        coordinator.updateSettings(defaults)
        _status.update { it.copy(paired = false, backendBaseUrl = null, backendReachable = null, lastErrorHebrew = null) }
    }

    private suspend fun checkHealth(baseUrl: String) {
        val health = api.health(baseUrl)
        _status.update { it.copy(backendReachable = health?.ok == true) }
    }

    // ---- system ---------------------------------------------------------------------------

    override fun openNotificationAccessSettings() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            SafeLog.e(SafeLog.Event.CONTROLLER_FAILURE, e)
            context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    override fun refreshPermissions() {
        val accessGranted = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
        val postGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else {
            NotificationManagerCompat.from(context).areNotificationsEnabled()
        }
        val creds = credentialsCache
        _status.update {
            it.copy(
                notificationAccessGranted = accessGranted,
                postNotificationsGranted = postGranted,
                listenerConnected = ListenerState.connected.value,
                paired = creds != null,
                backendBaseUrl = creds?.baseUrl ?: it.backendBaseUrl,
                deviceLocked = isDeviceLocked(),
            )
        }
        if (accessGranted && !ListenerState.connected.value) requestListenerRebind()
    }

    /** Access is granted but the system has not (re)bound us — e.g. after an app update or a One UI kill. */
    private fun requestListenerRebind() {
        try {
            NotificationListenerService.requestRebind(ComponentName(context, NoaNotificationListenerService::class.java))
            SafeLog.i(SafeLog.Event.LISTENER_REBIND_REQUESTED)
        } catch (e: RuntimeException) {
            SafeLog.e(SafeLog.Event.CONTROLLER_FAILURE, e)
        }
    }

    private fun setError(messageHebrew: String) {
        _status.update { it.copy(lastErrorHebrew = messageHebrew) }
    }

    /**
     * Runs while the platform graph is built — possibly from the notification listener on the
     * main thread. A keystore failure must never crash that path: treat it as "not paired".
     */
    private fun loadCredentials(): ApiCredentials? = try {
        val url = secureStore.baseUrl
        val token = secureStore.deviceToken
        if (url == null || token == null) null else ApiCredentials(url, token)
    } catch (e: RuntimeException) {
        SafeLog.e(SafeLog.Event.SECURE_STORE_DECRYPT_FAILED, e)
        null
    }

    companion object {
        const val MSG_LOCKED = "יש לבטל את נעילת הטלפון לפני שליחה"
        const val MSG_SENDING_DISABLED = "השליחה הניסיונית כבויה בהגדרות"
        const val MSG_NO_CONSENT = "לא ניתנה הסכמה לעיבוד הודעות בשרת"
        private const val REVOKE_TIMEOUT_MILLIS = 10_000L

        /** States in which cancel() is pointless or not allowed (terminal, or a send in flight). */
        private val NOT_CANCELLABLE = setOf(
            DraftState.FILTERED,
            DraftState.CANCELLED,
            DraftState.EXPIRED,
            DraftState.SENDING,
            DraftState.SEND_ATTEMPTED,
            DraftState.FAILED,
            DraftState.UNKNOWN_RESULT,
        )

        private fun excludedKeys(entries: List<ExclusionEntry>): Set<ConversationKey> =
            entries.mapNotNull { e -> e.conversationKeyValue.takeIf { it.isNotBlank() }?.let(::ConversationKey) }.toSet()

        private fun defaultLockCheck(context: Context): () -> Boolean = {
            context.getSystemService(KeyguardManager::class.java)?.isDeviceLocked ?: true
        }
    }
}
