package com.disciplineos.core.domain.repository

import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
import java.time.Instant
import java.time.LocalDate

/**
 * Persistence contracts. Implemented in :app (Room / DataStore). Domain logic depends only on these.
 * All writes are suspend; all reads are cold Flows that re-emit on change.
 */
interface TaskRepository {
    fun observeTasks(includeArchived: Boolean = false): Flow<List<Task>>
    fun observeTask(taskId: Long): Flow<Task?>
    fun observeSubTasks(taskId: Long): Flow<List<SubTask>>
    fun observeOccurrences(from: LocalDate, to: LocalDate): Flow<List<OccurrenceWithTask>>
    /** Every non-completed, non-skipped occurrence on or before [onOrBefore] (for carry-over/overdue). */
    fun observeOpenOccurrences(onOrBefore: LocalDate): Flow<List<OccurrenceWithTask>>
    fun observeCategories(): Flow<List<Category>>
    fun observeHistory(taskId: Long): Flow<List<TaskHistoryEntry>>

    suspend fun getTask(taskId: Long): Task?
    suspend fun getAllActiveTasks(): List<Task>
    suspend fun getOccurrences(taskId: Long, from: LocalDate, to: LocalDate): List<TaskOccurrence>
    suspend fun getOccurrence(occurrenceId: Long): TaskOccurrence?

    /** Insert or update; returns id. */
    suspend fun upsertTask(task: Task): Long
    suspend fun replaceSubTasks(taskId: Long, subTasks: List<SubTask>)
    suspend fun setSubTaskDone(subTaskId: Long, done: Boolean)
    suspend fun deleteTask(taskId: Long)
    /** Insert occurrences that do not already exist for (taskId, localDate). Idempotent. */
    suspend fun insertOccurrencesIfAbsent(occurrences: List<TaskOccurrence>)
    /** Remove PENDING occurrences of a task on/after [from] (used when a recurrence rule changes). */
    suspend fun deletePendingOccurrencesFrom(taskId: Long, from: LocalDate)
    suspend fun updateOccurrence(occurrence: TaskOccurrence)
    suspend fun upsertCategory(category: Category): Long
    suspend fun appendHistory(entry: TaskHistoryEntry)
}

interface BlockerRepository {
    fun observeConfig(): Flow<BlockerConfig>
    fun observeBlockedApps(): Flow<List<BlockedApp>>
    fun observeBypasses(since: Instant): Flow<List<BypassSession>>
    suspend fun updateConfig(transform: (BlockerConfig) -> BlockerConfig)
    suspend fun setBlockedApps(apps: List<BlockedApp>)
    suspend fun setAppEnabled(packageName: String, enabled: Boolean)
    suspend fun insertBypass(session: BypassSession): Long
    suspend fun endBypassEarly(id: Long, at: Instant)
}

interface FocusRepository {
    fun observeConfig(): Flow<FocusConfig>
    fun observeSessions(since: Instant): Flow<List<FocusSession>>
    suspend fun updateConfig(transform: (FocusConfig) -> FocusConfig)
    suspend fun insertSession(session: FocusSession): Long
    suspend fun updateSession(session: FocusSession)
    /** Persist the live timer so it survives process death. Null clears it. */
    suspend fun saveRunningState(state: FocusState?)
    suspend fun loadRunningState(): FocusState?
}

interface GamificationRepository {
    fun observeXpEvents(): Flow<List<XpEvent>>
    fun observeAchievements(): Flow<List<Achievement>>
    /** Returns false if [XpEvent.dedupeKey] already exists (idempotent awards). */
    suspend fun awardXp(event: XpEvent): Boolean
    suspend fun unlockAchievement(id: String, at: Instant): Boolean
    suspend fun streakFreezesUsed(): Int
    suspend fun recordStreakFreezeUsed(date: LocalDate)
}

interface SettingsRepository {
    fun observeSettings(): Flow<AppSettings>
    fun observeAiPrivacy(): Flow<AiPrivacySettings>
    suspend fun updateSettings(transform: (AppSettings) -> AppSettings)
    suspend fun updateAiPrivacy(transform: (AiPrivacySettings) -> AiPrivacySettings)
}

interface ChatRepository {
    fun observeMessages(): Flow<List<ChatMessage>>
    suspend fun insertMessage(message: ChatMessage): Long
    suspend fun updateMessage(message: ChatMessage)
    suspend fun countUserMessagesSince(since: Instant): Int
    suspend fun clear()
}

/** Wipes every local table and preference ("delete all my data"). */
interface DataWipeRepository {
    suspend fun wipeAll()
}

/** Android-side reminder scheduling (WorkManager/AlarmManager). Called after any task change. */
interface ReminderScheduler {
    suspend fun rescheduleAll()
    suspend fun cancelForTask(taskId: Long)
}

/** Screen-time data from UsageStatsManager. Returns null when permission is missing (never fakes data). */
interface ScreenTimeSource {
    fun hasPermission(): Boolean
    /** Foreground time per package for a local day, or null if unavailable. */
    suspend fun usageForDay(date: LocalDate): Map<String, java.time.Duration>?
}
