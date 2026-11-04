package com.disciplineos.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
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

/**
 * Bulk snapshot / restore used only by BackupManager. Inserts use the default ABORT strategy on purpose:
 * the import runs inside one transaction after the tables were emptied, so any conflict is a bug in the
 * validated document and must roll the whole import back.
 */
@Dao
interface BackupDao {
    @Query("SELECT * FROM categories ORDER BY id") suspend fun allCategories(): List<CategoryEntity>
    @Query("SELECT * FROM tasks ORDER BY id") suspend fun allTasks(): List<TaskEntity>
    @Query("SELECT * FROM task_dependencies") suspend fun allDependencies(): List<TaskDependencyEntity>
    @Query("SELECT * FROM sub_tasks ORDER BY id") suspend fun allSubTasks(): List<SubTaskEntity>
    @Query("SELECT * FROM task_occurrences ORDER BY id") suspend fun allOccurrences(): List<TaskOccurrenceEntity>
    @Query("SELECT * FROM task_history ORDER BY id") suspend fun allHistory(): List<TaskHistoryEntity>
    @Query("SELECT * FROM blocked_apps") suspend fun allBlockedApps(): List<BlockedAppEntity>
    @Query("SELECT * FROM focus_sessions ORDER BY id") suspend fun allFocusSessions(): List<FocusSessionEntity>
    @Query("SELECT * FROM xp_events ORDER BY id") suspend fun allXpEvents(): List<XpEventEntity>
    @Query("SELECT * FROM achievements") suspend fun allAchievements(): List<AchievementEntity>
    @Query("SELECT * FROM streak_freezes ORDER BY id") suspend fun allStreakFreezes(): List<StreakFreezeEntity>

    // Children first is not required (FK cascades), but explicit deletes keep the intent obvious.
    @Query("DELETE FROM task_dependencies") suspend fun deleteDependencies()
    @Query("DELETE FROM sub_tasks") suspend fun deleteSubTasks()
    @Query("DELETE FROM task_occurrences") suspend fun deleteOccurrences()
    @Query("DELETE FROM task_history") suspend fun deleteHistory()
    @Query("DELETE FROM tasks") suspend fun deleteTasks()
    @Query("DELETE FROM categories") suspend fun deleteCategories()
    @Query("DELETE FROM blocked_apps") suspend fun deleteBlockedApps()
    @Query("DELETE FROM focus_sessions") suspend fun deleteFocusSessions()
    @Query("DELETE FROM xp_events") suspend fun deleteXpEvents()
    @Query("DELETE FROM achievements") suspend fun deleteAchievements()
    @Query("DELETE FROM streak_freezes") suspend fun deleteStreakFreezes()

    @Insert suspend fun insertCategories(rows: List<CategoryEntity>)
    @Insert suspend fun insertTasks(rows: List<TaskEntity>)
    @Insert suspend fun insertDependencies(rows: List<TaskDependencyEntity>)
    @Insert suspend fun insertSubTasks(rows: List<SubTaskEntity>)
    @Insert suspend fun insertOccurrences(rows: List<TaskOccurrenceEntity>)
    @Insert suspend fun insertHistory(rows: List<TaskHistoryEntity>)
    @Insert suspend fun insertBlockedApps(rows: List<BlockedAppEntity>)
    @Insert suspend fun insertFocusSessions(rows: List<FocusSessionEntity>)
    @Insert suspend fun insertXpEvents(rows: List<XpEventEntity>)
    @Insert suspend fun insertAchievements(rows: List<AchievementEntity>)
    @Insert suspend fun insertStreakFreezes(rows: List<StreakFreezeEntity>)
}
