package com.disciplineos.app.data.backup

import kotlinx.serialization.Serializable

/*
 * On-disk backup format, schemaVersion 1. Human-readable JSON; all timestamps are ISO-8601 strings
 * (Instant: "2026-11-04T08:00:00Z", LocalDate: "2026-11-04", LocalTime: "08:30"). Enum fields hold enum names.
 *
 * Deliberately EXCLUDED: chat history, bypass log (app-usage behaviour), AI privacy settings (an import must
 * never silently enable a remote provider), secrets (SecureStore), the live focus timer.
 * See docs/DATABASE.md#backup-format.
 */

@Serializable
data class BackupDocumentDto(
    /** Required; there is no default so a file without it is rejected. */
    val schemaVersion: Int,
    val app: String,
    val exportedAt: String,
    val settings: SettingsDto? = null,
    val blockerConfig: BlockerConfigBackupDto? = null,
    val focusConfig: FocusConfigBackupDto? = null,
    val categories: List<CategoryDto> = emptyList(),
    val tasks: List<TaskDto> = emptyList(),
    val occurrences: List<OccurrenceDto> = emptyList(),
    val history: List<HistoryDto> = emptyList(),
    val blockedApps: List<BlockedAppDto> = emptyList(),
    val focusSessions: List<FocusSessionDto> = emptyList(),
    val xpEvents: List<XpEventDto> = emptyList(),
    val achievements: List<AchievementDto> = emptyList(),
    val streakFreezes: List<StreakFreezeDto> = emptyList(),
)

@Serializable
data class SettingsDto(
    val language: String,
    val onboardingCompleted: Boolean,
    val notificationsEnabled: Boolean,
    val dailyPlanningTime: String,
    val weekStart: String,
    val reduceMotion: Boolean,
    val highContrast: Boolean,
)

@Serializable
data class BlockerConfigBackupDto(
    val enabled: Boolean,
    val carryOverOverdue: Boolean,
    val blockDuringFocus: Boolean,
    val bypassDurationMinutes: Int,
    val maxBypassesPerDay: Int,
    val bypassCooldownMinutes: Int,
    val recoveryUntil: String? = null,
    val userExemptPackages: List<String> = emptyList(),
)

@Serializable
data class FocusConfigBackupDto(
    val workMinutes: Int,
    val shortBreakMinutes: Int,
    val longBreakMinutes: Int,
    val sessionsBeforeLongBreak: Int,
    val autoStartBreaks: Boolean,
    val autoStartWork: Boolean,
)

@Serializable
data class CategoryDto(val id: Long, val name: String, val colorHex: String, val iconKey: String)

@Serializable
data class SubTaskDto(val id: Long, val title: String, val done: Boolean, val position: Int)

@Serializable
data class TaskDto(
    val id: Long,
    val title: String,
    val notes: String = "",
    val kind: String,
    val priority: String,
    val categoryId: Long? = null,
    val startDate: String,
    val dueTime: String? = null,
    val endDate: String? = null,
    val zoneId: String,
    /** RecurrenceCodec encoding (opaque here). */
    val recurrence: String = "",
    val reminderOffsetsMinutes: List<Int> = emptyList(),
    val estimatedMinutes: Int? = null,
    val verification: String,
    val dependsOn: List<Long> = emptyList(),
    val archived: Boolean = false,
    val createdAt: String,
    val updatedAt: String,
    val subTasks: List<SubTaskDto> = emptyList(),
)

@Serializable
data class OccurrenceDto(
    val id: Long,
    val taskId: Long,
    val localDate: String,
    val dueAt: String? = null,
    val status: String,
    val completedAt: String? = null,
    val snoozedUntil: String? = null,
    val snoozeCount: Int = 0,
    val verificationNote: String? = null,
)

@Serializable
data class HistoryDto(
    val id: Long,
    val taskId: Long,
    val occurrenceId: Long? = null,
    val type: String,
    val at: String,
    val detail: String = "",
)

@Serializable
data class BlockedAppDto(val packageName: String, val label: String, val enabled: Boolean, val suggestedByDefault: Boolean = false)

@Serializable
data class FocusSessionDto(
    val id: Long,
    val taskId: Long? = null,
    val startedAt: String,
    val endedAt: String? = null,
    val plannedSeconds: Long,
    val focusedSeconds: Long,
    val completed: Boolean,
    val interruptions: Int,
)

@Serializable
data class XpEventDto(val id: Long, val at: String, val amount: Int, val source: String, val dedupeKey: String)

@Serializable
data class AchievementDto(val id: String, val unlockedAt: String)

@Serializable
data class StreakFreezeDto(val id: Long, val localDate: String, val usedAt: String)
