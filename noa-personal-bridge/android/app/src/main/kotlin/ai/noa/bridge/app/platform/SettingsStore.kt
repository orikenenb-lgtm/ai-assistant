package ai.noa.bridge.app.platform

import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.ConversationKey
import android.content.Context

/**
 * Non-sensitive [BridgeSettings] flags (plain SharedPreferences "noa_bridge_settings").
 * The exclusion set is NOT stored here — it lives encrypted in [SecureStore].
 */
class SettingsStore(
    private val context: Context,
    private val prefsName: String = PREFS_NAME,
) {
    private val prefs get() = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    fun load(excluded: Set<ConversationKey>, debounceMillis: Long): BridgeSettings = BridgeSettings(
        paused = prefs.getBoolean(KEY_PAUSED, false),
        emergencyStopped = prefs.getBoolean(KEY_EMERGENCY, false),
        cloudConsentGiven = prefs.getBoolean(KEY_CONSENT, false),
        sendingEnabled = prefs.getBoolean(KEY_SENDING, false),
        excludedConversations = excluded,
        debounceMillis = debounceMillis,
    )

    fun save(settings: BridgeSettings) {
        prefs.edit()
            .putBoolean(KEY_PAUSED, settings.paused)
            .putBoolean(KEY_EMERGENCY, settings.emergencyStopped)
            .putBoolean(KEY_CONSENT, settings.cloudConsentGiven)
            .putBoolean(KEY_SENDING, settings.sendingEnabled)
            .commit()
    }

    fun wipeAll() {
        prefs.edit().clear().commit()
        context.deleteSharedPreferences(prefsName)
    }

    companion object {
        const val PREFS_NAME = "noa_bridge_settings"
        private const val KEY_PAUSED = "paused"
        private const val KEY_EMERGENCY = "emergency_stopped"
        private const val KEY_CONSENT = "cloud_consent"
        private const val KEY_SENDING = "sending_enabled"
    }
}
