package com.disciplineos.app.data.prefs

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import com.disciplineos.app.data.mapper.enumOr
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.model.AiPrivacySettings
import com.disciplineos.core.model.AppSettings
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import java.time.DayOfWeek
import java.time.LocalTime
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepositoryImpl @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) : SettingsRepository {

    override fun observeSettings(): Flow<AppSettings> =
        dataStore.safeData().map { readSettings(it) }.distinctUntilChanged()

    override fun observeAiPrivacy(): Flow<AiPrivacySettings> =
        dataStore.safeData().map { readAiPrivacy(it) }.distinctUntilChanged()

    override suspend fun updateSettings(transform: (AppSettings) -> AppSettings) {
        dataStore.edit { prefs ->
            val s = transform(readSettings(prefs))
            prefs[PrefKeys.LANGUAGE] = s.language.name
            prefs[PrefKeys.ONBOARDING_COMPLETED] = s.onboardingCompleted
            prefs[PrefKeys.NOTIFICATIONS_ENABLED] = s.notificationsEnabled
            prefs[PrefKeys.DAILY_PLANNING_SECOND_OF_DAY] = s.dailyPlanningTime.toSecondOfDay()
            prefs[PrefKeys.WEEK_START] = s.weekStart.name
            prefs[PrefKeys.REDUCE_MOTION] = s.reduceMotion
            prefs[PrefKeys.HIGH_CONTRAST] = s.highContrast
        }
    }

    override suspend fun updateAiPrivacy(transform: (AiPrivacySettings) -> AiPrivacySettings) {
        dataStore.edit { prefs ->
            val s = transform(readAiPrivacy(prefs))
            prefs[PrefKeys.AI_REMOTE_ENABLED] = s.remoteProviderEnabled
            prefs[PrefKeys.AI_SHARE_TITLES] = s.shareTaskTitles
            prefs[PrefKeys.AI_SHARE_APP_USAGE] = s.shareAppUsage
            prefs[PrefKeys.AI_DAILY_LIMIT] = s.dailyMessageLimit
        }
    }

    internal companion object {
        fun readSettings(p: Preferences): AppSettings {
            val d = AppSettings()
            return AppSettings(
                language = enumOr(p[PrefKeys.LANGUAGE], d.language),
                onboardingCompleted = p[PrefKeys.ONBOARDING_COMPLETED] ?: d.onboardingCompleted,
                notificationsEnabled = p[PrefKeys.NOTIFICATIONS_ENABLED] ?: d.notificationsEnabled,
                dailyPlanningTime = p[PrefKeys.DAILY_PLANNING_SECOND_OF_DAY]
                    ?.takeIf { it in 0 until 86_400 }
                    ?.let { LocalTime.ofSecondOfDay(it.toLong()) }
                    ?: d.dailyPlanningTime,
                weekStart = enumOr<DayOfWeek>(p[PrefKeys.WEEK_START], d.weekStart),
                reduceMotion = p[PrefKeys.REDUCE_MOTION] ?: d.reduceMotion,
                highContrast = p[PrefKeys.HIGH_CONTRAST] ?: d.highContrast,
            )
        }

        fun readAiPrivacy(p: Preferences): AiPrivacySettings {
            val d = AiPrivacySettings()
            return AiPrivacySettings(
                remoteProviderEnabled = p[PrefKeys.AI_REMOTE_ENABLED] ?: d.remoteProviderEnabled,
                shareTaskTitles = p[PrefKeys.AI_SHARE_TITLES] ?: d.shareTaskTitles,
                shareAppUsage = p[PrefKeys.AI_SHARE_APP_USAGE] ?: d.shareAppUsage,
                dailyMessageLimit = p[PrefKeys.AI_DAILY_LIMIT] ?: d.dailyMessageLimit,
            )
        }
    }
}
