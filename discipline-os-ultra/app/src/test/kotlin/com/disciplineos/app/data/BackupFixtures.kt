package com.disciplineos.app.data

import com.disciplineos.app.data.backup.BackupSnapshot
import com.disciplineos.app.data.local.entity.AchievementEntity
import com.disciplineos.app.data.local.entity.BlockedAppEntity
import com.disciplineos.app.data.local.entity.CategoryEntity
import com.disciplineos.app.data.local.entity.FocusSessionEntity
import com.disciplineos.app.data.local.entity.StreakFreezeEntity
import com.disciplineos.app.data.local.entity.SubTaskEntity
import com.disciplineos.app.data.local.entity.TaskDependencyEntity
import com.disciplineos.app.data.local.entity.TaskEntity
import com.disciplineos.app.data.local.entity.TaskHistoryEntity
import com.disciplineos.app.data.local.entity.TaskOccurrenceEntity
import com.disciplineos.app.data.local.entity.XpEventEntity
import com.disciplineos.core.model.AppLanguage
import com.disciplineos.core.model.AppSettings
import com.disciplineos.core.model.BlockerConfig
import com.disciplineos.core.model.FocusConfig
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

/** A small but complete snapshot touching every table and every nullable field. Timestamps are whole millis. */
fun backupTestSnapshot(): BackupSnapshot {
    val t0 = Instant.parse("2026-11-01T07:00:00Z")
    val day = LocalDate.of(2026, 11, 4)
    return BackupSnapshot(
        settings = AppSettings(AppLanguage.ENGLISH, true, false, LocalTime.of(7, 30), DayOfWeek.MONDAY, true, false),
        blockerConfig = BlockerConfig(enabled = true, recoveryUntil = t0, userExemptPackages = setOf("com.bank.app")),
        focusConfig = FocusConfig(workMinutes = 50),
        categories = listOf(CategoryEntity(1, "בריאות", "#FF5722", "heart")),
        tasks = listOf(
            TaskEntity(10, "Task one", "", "MANDATORY", "HIGH", 1, day, LocalTime.of(18, 0), null, "Asia/Jerusalem", "D1", "60,10", 30, "NONE", false, t0, t0),
            TaskEntity(11, "Task two", "notes", "OPTIONAL", "LOW", null, day.minusDays(3), null, day.plusDays(30), "UTC", "", "", null, "REFLECTION_NOTE", true, t0, t0.plusSeconds(60)),
        ),
        dependencies = listOf(TaskDependencyEntity(10, 11)),
        subTasks = listOf(SubTaskEntity(100, 10, "step a", true, 0), SubTaskEntity(101, 10, "step b", false, 1)),
        occurrences = listOf(
            TaskOccurrenceEntity(1000, 10, day, t0.plusSeconds(3600), "PENDING", null, t0.plusSeconds(1800), 1, null),
            TaskOccurrenceEntity(1001, 11, day.minusDays(1), null, "COMPLETED", t0, null, 0, "felt good"),
        ),
        history = listOf(
            TaskHistoryEntity(1, 10, null, "CREATED", t0, ""),
            TaskHistoryEntity(2, 999, 5, "DELETED", t0, "gone"), // references a deleted task: allowed
        ),
        blockedApps = listOf(BlockedAppEntity("com.instagram.android", "Instagram", true, true)),
        focusSessions = listOf(FocusSessionEntity(1, 10, t0, t0.plusSeconds(1500), 1500, 1500, true, 0), FocusSessionEntity(2, null, t0, null, 1500, 0, false, 2)),
        xpEvents = listOf(XpEventEntity(1, t0, 20, "TASK_COMPLETED", "occ:1001")),
        achievements = listOf(AchievementEntity("first_task", t0)),
        streakFreezes = listOf(StreakFreezeEntity(1, day.minusDays(2), t0)),
    )
}
