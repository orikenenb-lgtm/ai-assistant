package com.disciplineos.app.enforcement

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

enum class EnforcementMode {
    /** Default: UsageStats polling + "display over other apps" to show the block screen. */
    USAGE_STATS,

    /** Optional: AccessibilityService reads only the package name of window-state changes. Requires disclosure consent. */
    ACCESSIBILITY,
}

/**
 * Small local preferences that belong to the Android enforcement layer only (not part of the domain model):
 * the chosen detection mode and the accessibility disclosure consent. Stored in app-private storage, never synced.
 */
@Singleton
class EnforcementPrefs @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    private val _mode = MutableStateFlow(readMode())
    val mode: StateFlow<EnforcementMode> = _mode.asStateFlow()

    private val _accessibilityConsentAt = MutableStateFlow(prefs.getLong(KEY_A11Y_CONSENT_AT, 0L).takeIf { it > 0L })
    /** Epoch millis of explicit consent to the accessibility disclosure, or null. */
    val accessibilityConsentAt: StateFlow<Long?> = _accessibilityConsentAt.asStateFlow()

    val accessibilityConsented: Boolean get() = _accessibilityConsentAt.value != null

    fun setMode(mode: EnforcementMode) {
        prefs.edit().putString(KEY_MODE, mode.name).apply()
        _mode.value = mode
    }

    fun giveAccessibilityConsent(nowMillis: Long = System.currentTimeMillis()) {
        prefs.edit().putLong(KEY_A11Y_CONSENT_AT, nowMillis).apply()
        _accessibilityConsentAt.value = nowMillis
    }

    /** Withdrawing consent also returns to the default mode; the running service disables itself. */
    fun withdrawAccessibilityConsent() {
        prefs.edit().remove(KEY_A11Y_CONSENT_AT).putString(KEY_MODE, EnforcementMode.USAGE_STATS.name).apply()
        _accessibilityConsentAt.value = null
        _mode.value = EnforcementMode.USAGE_STATS
    }

    private fun readMode(): EnforcementMode =
        runCatching { EnforcementMode.valueOf(prefs.getString(KEY_MODE, null) ?: "") }.getOrDefault(EnforcementMode.USAGE_STATS)

    private companion object {
        const val FILE = "enforcement_prefs"
        const val KEY_MODE = "mode"
        const val KEY_A11Y_CONSENT_AT = "a11y_consent_at"
    }
}
