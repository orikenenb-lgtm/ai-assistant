package com.disciplineos.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.time.Instant
import java.time.LocalDate

@Entity(tableName = "blocked_apps")
data class BlockedAppEntity(
    @PrimaryKey val packageName: String,
    val label: String,
    val enabled: Boolean,
    val suggestedByDefault: Boolean,
)

@Entity(tableName = "bypass_sessions", indices = [Index("startedAt")])
data class BypassSessionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val startedAt: Instant,
    val endsAt: Instant,
    val reason: String,
    val note: String,
    val endedEarlyAt: Instant?,
)

/** [taskId] has no FK on purpose: focus statistics must survive deletion of the task they were linked to. */
@Entity(tableName = "focus_sessions", indices = [Index("startedAt")])
data class FocusSessionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val taskId: Long?,
    val startedAt: Instant,
    val endedAt: Instant?,
    val plannedSeconds: Long,
    val focusedSeconds: Long,
    val completed: Boolean,
    val interruptions: Int,
)

/** Unique [dedupeKey] makes XP awards idempotent (`INSERT OR IGNORE` returns -1 for a duplicate). */
@Entity(tableName = "xp_events", indices = [Index(value = ["dedupeKey"], unique = true), Index("at")])
data class XpEventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val at: Instant,
    val amount: Int,
    val source: String,
    val dedupeKey: String,
)

/** A row exists only once the achievement is unlocked. */
@Entity(tableName = "achievements")
data class AchievementEntity(
    @PrimaryKey val id: String,
    val unlockedAt: Instant,
)

@Entity(tableName = "streak_freezes", indices = [Index(value = ["localDate"], unique = true)])
data class StreakFreezeEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val localDate: LocalDate,
    val usedAt: Instant,
)

/** [actionsJson] is a JSON array of `ProposedActionDto` (see data/local/json). */
@Entity(tableName = "chat_messages", indices = [Index("createdAt")])
data class ChatMessageEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val role: String,
    val text: String,
    val createdAt: Instant,
    val actionsJson: String,
)
