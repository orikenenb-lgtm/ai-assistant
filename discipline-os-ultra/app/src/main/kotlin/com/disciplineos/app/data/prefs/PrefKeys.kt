package com.disciplineos.app.data.prefs

import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey

/** All keys of the single app Preferences DataStore ("discipline_prefs"). */
object PrefKeys {
    const val DATASTORE_NAME = "discipline_prefs"

    // AppSettings
    val LANGUAGE = stringPreferencesKey("settings.language")
    val ONBOARDING_COMPLETED = booleanPreferencesKey("settings.onboarding_completed")
    val NOTIFICATIONS_ENABLED = booleanPreferencesKey("settings.notifications_enabled")
    val DAILY_PLANNING_SECOND_OF_DAY = intPreferencesKey("settings.daily_planning_sod")
    val WEEK_START = stringPreferencesKey("settings.week_start")
    val REDUCE_MOTION = booleanPreferencesKey("settings.reduce_motion")
    val HIGH_CONTRAST = booleanPreferencesKey("settings.high_contrast")

    // AiPrivacySettings
    val AI_REMOTE_ENABLED = booleanPreferencesKey("ai.remote_enabled")
    val AI_SHARE_TITLES = booleanPreferencesKey("ai.share_titles")
    val AI_SHARE_APP_USAGE = booleanPreferencesKey("ai.share_app_usage")
    val AI_DAILY_LIMIT = intPreferencesKey("ai.daily_limit")

    // Structured JSON blobs (see PrefsCodec)
    val BLOCKER_CONFIG_JSON = stringPreferencesKey("blocker.config_json")
    val FOCUS_CONFIG_JSON = stringPreferencesKey("focus.config_json")
    val FOCUS_RUNNING_STATE_JSON = stringPreferencesKey("focus.running_state_json")

    /** Prefix for SecureStore ciphertexts (Base64 of IV || AES-GCM ciphertext). */
    const val SECURE_PREFIX = "secure."
}
