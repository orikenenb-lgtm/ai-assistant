package com.disciplineos.core.model

import java.time.DayOfWeek
import java.time.LocalTime

enum class AppLanguage { HEBREW, ENGLISH, SYSTEM }

data class AppSettings(
    val language: AppLanguage = AppLanguage.HEBREW,
    val onboardingCompleted: Boolean = false,
    val notificationsEnabled: Boolean = true,
    val dailyPlanningTime: LocalTime = LocalTime.of(8, 0),
    val weekStart: DayOfWeek = DayOfWeek.SUNDAY,
    val reduceMotion: Boolean = false,
    val highContrast: Boolean = false,
)
