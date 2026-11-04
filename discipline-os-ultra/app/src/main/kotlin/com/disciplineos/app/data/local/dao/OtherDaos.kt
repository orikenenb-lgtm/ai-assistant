package com.disciplineos.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.disciplineos.app.data.local.entity.AchievementEntity
import com.disciplineos.app.data.local.entity.BlockedAppEntity
import com.disciplineos.app.data.local.entity.BypassSessionEntity
import com.disciplineos.app.data.local.entity.ChatMessageEntity
import com.disciplineos.app.data.local.entity.FocusSessionEntity
import com.disciplineos.app.data.local.entity.StreakFreezeEntity
import com.disciplineos.app.data.local.entity.XpEventEntity
import kotlinx.coroutines.flow.Flow
import java.time.Instant
import java.time.LocalDate

@Dao
interface BlockerDao {
    @Query("SELECT * FROM blocked_apps ORDER BY label COLLATE NOCASE ASC")
    fun observeBlockedApps(): Flow<List<BlockedAppEntity>>

    @Query("DELETE FROM blocked_apps")
    suspend fun deleteAllBlockedApps()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertBlockedApps(apps: List<BlockedAppEntity>)

    @Query("UPDATE blocked_apps SET enabled = :enabled WHERE packageName = :packageName")
    suspend fun setAppEnabled(packageName: String, enabled: Boolean): Int

    /** Sessions that started at/after [since] or were still running at [since]. */
    @Query("SELECT * FROM bypass_sessions WHERE startedAt >= :since OR endsAt >= :since ORDER BY startedAt DESC")
    fun observeBypasses(since: Instant): Flow<List<BypassSessionEntity>>

    @Insert
    suspend fun insertBypass(session: BypassSessionEntity): Long

    /** Only the first early end is recorded; a second call is a no-op. */
    @Query("UPDATE bypass_sessions SET endedEarlyAt = :at WHERE id = :id AND endedEarlyAt IS NULL")
    suspend fun endBypassEarly(id: Long, at: Instant): Int
}

@Dao
interface FocusDao {
    @Query("SELECT * FROM focus_sessions WHERE startedAt >= :since ORDER BY startedAt ASC")
    fun observeSessions(since: Instant): Flow<List<FocusSessionEntity>>

    @Insert
    suspend fun insertSession(session: FocusSessionEntity): Long

    @Update
    suspend fun updateSession(session: FocusSessionEntity): Int
}

@Dao
interface GamificationDao {
    @Query("SELECT * FROM xp_events ORDER BY at ASC, id ASC")
    fun observeXpEvents(): Flow<List<XpEventEntity>>

    /** Returns -1 when [XpEventEntity.dedupeKey] already exists. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertXpEvent(event: XpEventEntity): Long

    @Query("SELECT * FROM achievements ORDER BY unlockedAt ASC")
    fun observeAchievements(): Flow<List<AchievementEntity>>

    /** Returns -1 when already unlocked (first unlock time is kept). */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAchievement(achievement: AchievementEntity): Long

    @Query("SELECT COUNT(*) FROM streak_freezes")
    suspend fun countStreakFreezes(): Int

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertStreakFreeze(freeze: StreakFreezeEntity): Long

    @Query("SELECT * FROM streak_freezes WHERE localDate = :date")
    suspend fun getStreakFreeze(date: LocalDate): StreakFreezeEntity?
}

@Dao
interface ChatDao {
    @Query("SELECT * FROM chat_messages ORDER BY createdAt ASC, id ASC")
    fun observeMessages(): Flow<List<ChatMessageEntity>>

    @Insert
    suspend fun insertMessage(message: ChatMessageEntity): Long

    @Update
    suspend fun updateMessage(message: ChatMessageEntity): Int

    @Query("SELECT COUNT(*) FROM chat_messages WHERE role = 'USER' AND createdAt >= :since")
    suspend fun countUserMessagesSince(since: Instant): Int

    @Query("DELETE FROM chat_messages")
    suspend fun clear()
}
