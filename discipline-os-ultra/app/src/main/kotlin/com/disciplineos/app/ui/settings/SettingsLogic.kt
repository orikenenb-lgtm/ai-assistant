package com.disciplineos.app.ui.settings

import com.disciplineos.core.model.AppLanguage
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Pure settings helpers (unit-tested in SettingsLogicTest). */
object SettingsLogic {
    /** The word the user must type to confirm "delete all data". */
    const val DELETE_CONFIRM_WORD = "מחק"

    /** Accepts the confirmation word with surrounding whitespace; nothing else (no partial matches). */
    fun isDeleteConfirmed(input: String): Boolean = input.trim() == DELETE_CONFIRM_WORD

    /** Recovery mode presets offered in the UI (hours). RecoveryModeUseCase accepts 1..72. */
    val RECOVERY_PRESETS = listOf(1, 4, 24)

    fun isRecoveryActive(recoveryUntil: Instant?, now: Instant): Boolean = recoveryUntil != null && recoveryUntil.isAfter(now)

    /** BCP-47 tag for LocaleManager; null = follow the system. */
    fun languageTag(language: AppLanguage): String? = when (language) {
        AppLanguage.HEBREW -> "he"
        AppLanguage.ENGLISH -> "en"
        AppLanguage.SYSTEM -> null
    }

    /** Default backup file name, e.g. "discipline-os-backup-2026-11-04.json". */
    fun backupFileName(today: LocalDate): String = "discipline-os-backup-${today.format(DateTimeFormatter.ISO_LOCAL_DATE)}.json"

    /** "HH:mm" for an instant in [zone] (Locale.ROOT digits). */
    fun clockTime(instant: Instant, zone: ZoneId): String =
        DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT).format(instant.atZone(zone))

    /** Toggles [pkg] in an exemption set. */
    fun toggle(set: Set<String>, pkg: String): Set<String> = if (pkg in set) set - pkg else set + pkg

    /** Daily AI message limit bounds for the privacy slider. */
    val DAILY_LIMIT_RANGE = 5..200
}
