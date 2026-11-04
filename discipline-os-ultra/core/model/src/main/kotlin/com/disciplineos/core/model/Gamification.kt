package com.disciplineos.core.model

import java.time.Instant

enum class XpSource { TASK_COMPLETED, MANDATORY_DAY_CLEARED, FOCUS_SESSION, STREAK_BONUS, WEEKLY_REVIEW, ACHIEVEMENT }

data class XpEvent(
    val id: Long = 0,
    val at: Instant,
    val amount: Int,
    val source: XpSource,
    /** Idempotency key, e.g. "occ:42" — the same key is never awarded twice. */
    val dedupeKey: String,
)

data class PlayerProgress(
    val totalXp: Long,
    val level: Int,
    val xpIntoLevel: Long,
    val xpForNextLevel: Long,
    val currentStreakDays: Int,
    val bestStreakDays: Int,
    val streakFreezesAvailable: Int,
)

data class Achievement(
    val id: String,
    val unlockedAt: Instant?,
)
