package ai.noa.bridge.app.platform

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.ExclusionEntry
import ai.noa.bridge.app.PairingResult
import ai.noa.bridge.app.ServerRevokeResult
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Production [AppController]: wires the core [BridgeCoordinator] to the platform pieces and owns
 * persisted settings, exclusions and credentials.
 *
 * Safety rules enforced here (in addition to the core's own checks):
 * - [sendApproved] never reaches the coordinator while the device is locked, when the reply path
 *   is not compiled in, or when the experimental send toggle is off.
 * - Nothing is sent to the backend without cloud consent (the engine wrapper short-circuits).
 * - Emergency stop also turns the experimental send toggle off and drops every reply handle.
 * - The backend never sees the local conversation key: `conversation_ref` is an HMAC of it with a
 *   per-install secret ([ConversationRefs], S-M4).
 *
 * Threading (PERF-01/02): keystore decrypts (credentials, exclusions, ref secret) run on
 * [ioDispatcher] after construction; until they are loaded the coordinator runs with `paused`
 * (fail closed: no draft can be made for a conversation whose exclusion is not loaded yet).
 * Settings and exclusions are written on [ioDispatcher] with a synchronous commit; each write
 * stores the newest value, so out-of-order writes still leave the latest state on disk.
 * The plain settings flags (emergency stop, pause, consent, sending) are still read synchronously
 * at construction: they must apply before the first notification is handled.
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
    private var credentialsCache: ApiCredentials? = null

    /** Set once pair/disconnect/wipe changed the credentials, so the startup load never overrides them. */
    @Volatile
    private var credentialsTouched = false

    @Volatile
    private var exclusionsTouched = false

    /** True once credentials and exclusions were read from [secureStore] (see the class KDoc). */
    @Volatile
    private var storesLoaded = false

    @Volatile
    private var refSecret: ByteArray? = null
    private val refSecretLock = Any()
    private val settingsLock = Any()
    private val settingsWriteLock = Any()
    private val secureWriteLock = Any()

    private val api: BridgeApiClient = apiClientFactory({ credentialsCache }) {
        setError(BridgeApiClient.MSG_UNAUTHORIZED)
    }

    private val _exclusions = MutableStateFlow<List<ExclusionEntry>>(emptyList())
    override val exclusions: StateFlow<List<ExclusionEntry>> = _exclusions.asStateFlow()

    private val _settings = MutableStateFlow(sanitize(settingsStore.load(emptySet(), debounceMillis)))
    override val settings: StateFlow<BridgeSettings> = _settings.asStateFlow()

    private val _status = MutableStateFlow(BridgeStatus())
    override val status: StateFlow<BridgeStatus> = _status.asStateFlow()

    /** Consent gate + pseudonymous conversation_ref + status reporting around the real backend client. */
    private val engine = DraftEngineClient { request ->
        if (!_settings.value.cloudConsentGiven) {
            DraftResult.Failure(MSG_NO_CONSENT, retryable = false)
        } else {
            val wire = request.copy(conversationKey = ConversationKey(conversationRefOf(request.conversationKey)))
            val result = api.requestDraft(wire)
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

    val coordinator: BridgeCoordinator = coordinatorFactory(engine, replySender, forCoordinator(_settings.value))

    override val drafts: StateFlow<List<Draft>> = coordinator.drafts

    /** Reads the keystore-encrypted values off the main thread (PERF-01). */
    private val loadJob: Job = scope.launch(ioDispatcher) { loadSecureValues() }

    init {
        refreshPermissions()
        scope.launch { ListenerState.connected.collect { c -> _status.update { it.copy(listenerConnected = c) } } }
        if (notifier != null) scope.launch { coordinator.drafts.collect { notifier.onDrafts(it) } }
    }

    private fun loadSecureValues() {
        val creds = loadCredentials()
        val stored = try {
            secureStore.exclusions()
        } catch (e: RuntimeException) {
            SafeLog.e(SafeLog.Event.SECURE_STORE_DECRYPT_FAILED, e)
            emptyList()
        }
        if (!credentialsTouched) credentialsCache = creds
        if (!exclusionsTouched) _exclusions.value = stored
        storesLoaded = true
        updateSettings(persist = false) { it.copy(excludedConversations = excludedKeys(_exclusions.value)) }
        val current = credentialsCache
        _status.update { it.copy(paired = current != null, backendBaseUrl = current?.baseUrl ?: it.backendBaseUrl) }
        // Not inside loadJob: pair/disconnect wait for loadJob and must not wait for the network.
        if (current != null && !credentialsTouched) scope.launch { checkHealth(current) }
    }

    /** Until the stores are loaded the coordinator is paused, so an exclusion can never be missed. */
    private fun forCoordinator(s: BridgeSettings): BridgeSettings = if (storesLoaded) s else s.copy(paused = true)

    /** HMAC-SHA256(per-install secret, local key) as 64 hex chars (S-M4). Runs on the engine's thread. */
    internal fun conversationRefOf(key: ConversationKey): String {
        val secret = refSecret ?: synchronized(refSecretLock) {
            refSecret ?: secureStore.conversationRefSecret().also { refSecret = it }
        }
        return ConversationRefs.of(secret, key)
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
        exclusionsTouched = true
        _exclusions.value = entries
        updateSettings { it.copy(excludedConversations = excludedKeys(entries)) }
        // Keystore encryption + commit off the main thread (PERF-02); always writes the newest list.
        scope.launch(ioDispatcher) { synchronized(secureWriteLock) { secureStore.setExclusions(_exclusions.value) } }
    }

    private fun updateSettings(persist: Boolean = true, transform: (BridgeSettings) -> BridgeSettings) {
        synchronized(settingsLock) {
            val next = sanitize(transform(_settings.value))
            _settings.value = next
            coordinator.updateSettings(forCoordinator(next))
        }
        // Safety flags (emergency stop, consent, sending) must survive a crash: commit(), but off
        // the main thread (PERF-02). Every write stores the newest value, so ordering cannot lose one.
        if (persist) scope.launch(ioDispatcher) { synchronized(settingsWriteLock) { settingsStore.save(_settings.value) } }
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

    override suspend fun pair(baseUrl: String, pairingCode: String, spkiPin: String?): PairingResult {
        val url = BridgeApiClient.validateBaseUrl(baseUrl, allowDebugCleartext)
            ?: return PairingResult.Failure(BridgeApiClient.MSG_BAD_URL)
        val code = BridgeApiClient.normalizePairingCode(pairingCode)
            ?: return PairingResult.Failure(BridgeApiClient.MSG_BAD_CODE_FORMAT)
        val pin = if (spkiPin.isNullOrBlank()) {
            null
        } else {
            BridgeApiClient.normalizeSpkiPin(spkiPin) ?: return PairingResult.Failure(BridgeApiClient.MSG_BAD_PIN)
        }
        val canonicalUrl = url.toString()
        loadJob.join()
        return when (val outcome = api.pair(canonicalUrl, code, deviceName, pin)) {
            is PairOutcome.Failure -> {
                setError(outcome.messageHebrew)
                PairingResult.Failure(outcome.messageHebrew)
            }
            is PairOutcome.Success -> {
                withContext(ioDispatcher) {
                    synchronized(secureWriteLock) {
                        secureStore.baseUrl = canonicalUrl
                        secureStore.deviceId = outcome.deviceId
                        secureStore.deviceToken = outcome.deviceToken
                        secureStore.certificatePin = pin
                    }
                }
                val creds = ApiCredentials(canonicalUrl, outcome.deviceToken, pin)
                credentialsTouched = true
                credentialsCache = creds
                _status.update { it.copy(paired = true, backendBaseUrl = canonicalUrl, lastErrorHebrew = null) }
                scope.launch { checkHealth(creds) }
                PairingResult.Success
            }
        }
    }

    /**
     * Revokes on the server first (while the token is still known), then forgets the credentials.
     * Honest about the result (S-L5): when the server did not confirm, the token may still be valid
     * there and the status says how to revoke it with the admin CLI.
     */
    override suspend fun disconnect(): ServerRevokeResult {
        loadJob.join()
        val result = revokeOnServer()
        credentialsTouched = true
        credentialsCache = null
        withContext(ioDispatcher) { synchronized(secureWriteLock) { secureStore.clearCredentials() } }
        _status.update {
            it.copy(
                paired = false,
                backendReachable = null,
                lastErrorHebrew = if (result == ServerRevokeResult.NOT_CONFIRMED) MSG_REVOKE_NOT_CONFIRMED else it.lastErrorHebrew,
            )
        }
        return result
    }

    /** Best-effort server revoke first when paired (S-L5), then deletes everything local. */
    override suspend fun wipeLocalData(): ServerRevokeResult {
        loadJob.join()
        val result = revokeOnServer()
        coordinator.clearAll()
        registry.clear()
        notifier?.cancelAll()
        credentialsTouched = true
        exclusionsTouched = true
        credentialsCache = null
        _exclusions.value = emptyList()
        synchronized(refSecretLock) { refSecret = null } // a new conversation_ref secret after the wipe
        withContext(ioDispatcher) {
            synchronized(secureWriteLock) { secureStore.wipeAll() }
            synchronized(settingsWriteLock) { settingsStore.wipeAll() }
        }
        synchronized(settingsLock) {
            val defaults = sanitize(BridgeSettings())
            _settings.value = defaults
            coordinator.updateSettings(forCoordinator(defaults))
        }
        _status.update {
            it.copy(
                paired = false,
                backendBaseUrl = null,
                backendReachable = null,
                lastErrorHebrew = if (result == ServerRevokeResult.NOT_CONFIRMED) MSG_REVOKE_NOT_CONFIRMED else null,
            )
        }
        return result
    }

    private suspend fun revokeOnServer(): ServerRevokeResult {
        if (credentialsCache == null) return ServerRevokeResult.NOT_PAIRED
        val confirmed = try {
            api.revoke() // bounded by its own wall-clock call timeout (10 s)
        } catch (e: CancellationException) {
            throw e
        } catch (e: RuntimeException) {
            SafeLog.e(SafeLog.Event.CONTROLLER_FAILURE, e)
            false
        }
        if (!confirmed) SafeLog.w(SafeLog.Event.REVOKE_NOT_CONFIRMED)
        return if (confirmed) ServerRevokeResult.CONFIRMED else ServerRevokeResult.NOT_CONFIRMED
    }

    private suspend fun checkHealth(creds: ApiCredentials) {
        val health = api.health(creds.baseUrl, creds.spkiPin)
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
        if (url == null || token == null) null else ApiCredentials(url, token, secureStore.certificatePin)
    } catch (e: RuntimeException) {
        SafeLog.e(SafeLog.Event.SECURE_STORE_DECRYPT_FAILED, e)
        null
    }

    companion object {
        const val MSG_LOCKED = "יש לבטל את נעילת הטלפון לפני שליחה"
        const val MSG_SENDING_DISABLED = "השליחה הניסיונית כבויה בהגדרות"
        const val MSG_NO_CONSENT = "לא ניתנה הסכמה לעיבוד הודעות בשרת"
        /** The command name is an LTR isolate so it renders correctly inside the Hebrew sentence. */
        const val MSG_REVOKE_NOT_CONFIRMED =
            "הניתוק המקומי בוצע, אבל השרת לא אישר את הביטול — בטל את המכשיר בשרת עם \u2066revoke-device\u2069"

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
