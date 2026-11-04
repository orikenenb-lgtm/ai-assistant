package com.disciplineos.core.domain.gamification

import com.disciplineos.core.domain.repository.*
import com.disciplineos.core.domain.time.ClockTimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** Shared in-memory fakes and builders for the gamification / stats / coach tests (agent B2). */
object B2 {
    val ZONE: ZoneId = ZoneId.of("Asia/Jerusalem")
    val TODAY: LocalDate = LocalDate.of(2026, 11, 4)

    fun timeAt(date: LocalDate = TODAY, time: LocalTime = LocalTime.NOON): ClockTimeProvider =
        ClockTimeProvider(Clock.fixed(date.atTime(time).atZone(ZONE).toInstant(), ZONE))

    fun at(date: LocalDate, hour: Int, minute: Int = 0): Instant = date.atTime(hour, minute).atZone(ZONE).toInstant()

    fun task(
        id: Long,
        kind: TaskKind = TaskKind.MANDATORY,
        priority: Priority = Priority.MEDIUM,
        title: String = "משימה $id",
        categoryId: Long? = null,
        startDate: LocalDate = TODAY,
    ) = Task(
        id = id, title = title, kind = kind, priority = priority, categoryId = categoryId, startDate = startDate,
        zoneId = ZONE.id, createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH,
    )

    fun occ(
        id: Long,
        task: Task,
        date: LocalDate,
        status: OccurrenceStatus = OccurrenceStatus.COMPLETED,
        completedAt: Instant? = if (status == OccurrenceStatus.COMPLETED) at(date, 12) else null,
    ) = OccurrenceWithTask(
        occurrence = TaskOccurrence(id = id, taskId = task.id, localDate = date, dueAt = null, status = status, completedAt = completedAt),
        task = task,
    )

    /** One mandatory occurrence per day, ids derived from the date. */
    fun mandatoryDays(vararg days: Pair<LocalDate, OccurrenceStatus>): List<OccurrenceWithTask> {
        val t = task(1)
        return days.map { (d, s) -> occ(d.toEpochDay(), t, d, s) }
    }

    fun session(id: Long, start: Instant, minutes: Long, completed: Boolean = true) = FocusSession(
        id = id, startedAt = start, endedAt = start.plusSeconds(minutes * 60), plannedSeconds = minutes * 60,
        focusedSeconds = minutes * 60, completed = completed,
    )
}

class FakeTaskRepository : TaskRepository {
    val occurrences = MutableStateFlow<List<OccurrenceWithTask>>(emptyList())
    val tasks = MutableStateFlow<Map<Long, Task>>(emptyMap())
    val subTasks = MutableStateFlow<Map<Long, List<SubTask>>>(emptyMap())
    val categories = MutableStateFlow<List<Category>>(emptyList())

    fun setOccurrences(list: List<OccurrenceWithTask>) {
        occurrences.value = list
        tasks.update { m -> m + list.associate { it.task.id to it.task } }
    }

    override fun observeTasks(includeArchived: Boolean): Flow<List<Task>> = tasks.map { it.values.toList() }
    override fun observeTask(taskId: Long): Flow<Task?> = tasks.map { it[taskId] }
    override fun observeSubTasks(taskId: Long): Flow<List<SubTask>> = subTasks.map { it[taskId].orEmpty() }
    override fun observeOccurrences(from: LocalDate, to: LocalDate): Flow<List<OccurrenceWithTask>> =
        occurrences.map { l -> l.filter { !it.occurrence.localDate.isBefore(from) && !it.occurrence.localDate.isAfter(to) } }
    override fun observeOpenOccurrences(onOrBefore: LocalDate): Flow<List<OccurrenceWithTask>> =
        occurrences.map { l ->
            l.filter {
                !it.occurrence.localDate.isAfter(onOrBefore) &&
                    it.occurrence.status != OccurrenceStatus.COMPLETED && it.occurrence.status != OccurrenceStatus.SKIPPED
            }
        }
    override fun observeCategories(): Flow<List<Category>> = categories
    override fun observeHistory(taskId: Long): Flow<List<TaskHistoryEntry>> = error("unused")
    override suspend fun getTask(taskId: Long): Task? = tasks.value[taskId]
    override suspend fun getAllActiveTasks(): List<Task> = tasks.value.values.filter { !it.archived }
    override suspend fun getOccurrences(taskId: Long, from: LocalDate, to: LocalDate): List<TaskOccurrence> = error("unused")
    override suspend fun getOccurrence(occurrenceId: Long): TaskOccurrence? = error("unused")
    override suspend fun upsertTask(task: Task): Long = error("unused")
    override suspend fun replaceSubTasks(taskId: Long, subTasks: List<SubTask>) = error("unused")
    override suspend fun setSubTaskDone(subTaskId: Long, done: Boolean) = error("unused")
    override suspend fun deleteTask(taskId: Long) = error("unused")
    override suspend fun insertOccurrencesIfAbsent(occurrences: List<TaskOccurrence>) = error("unused")
    override suspend fun deletePendingOccurrencesFrom(taskId: Long, from: LocalDate) = error("unused")
    override suspend fun updateOccurrence(occurrence: TaskOccurrence) = error("unused")
    override suspend fun upsertCategory(category: Category): Long = error("unused")
    override suspend fun appendHistory(entry: TaskHistoryEntry) = error("unused")
}

class FakeGamificationRepository : GamificationRepository {
    val events = MutableStateFlow<List<XpEvent>>(emptyList())
    val achievements = MutableStateFlow<List<Achievement>>(emptyList())
    val freezesUsed = mutableListOf<LocalDate>()
    var unlockCalls = 0

    override fun observeXpEvents(): Flow<List<XpEvent>> = events
    override fun observeAchievements(): Flow<List<Achievement>> = achievements
    override suspend fun awardXp(event: XpEvent): Boolean {
        if (events.value.any { it.dedupeKey == event.dedupeKey }) return false
        events.update { it + event.copy(id = it.size + 1L) }
        return true
    }
    override suspend fun unlockAchievement(id: String, at: Instant): Boolean {
        unlockCalls++
        if (achievements.value.any { it.id == id && it.unlockedAt != null }) return false
        achievements.update { it + Achievement(id, at) }
        return true
    }
    override suspend fun streakFreezesUsed(): Int = freezesUsed.size
    override suspend fun recordStreakFreezeUsed(date: LocalDate) {
        if (date !in freezesUsed) freezesUsed += date
    }
}

class FakeFocusRepository : FocusRepository {
    val sessions = MutableStateFlow<List<FocusSession>>(emptyList())
    override fun observeConfig(): Flow<FocusConfig> = error("unused")
    override fun observeSessions(since: Instant): Flow<List<FocusSession>> = sessions.map { l -> l.filter { !it.startedAt.isBefore(since) } }
    override suspend fun updateConfig(transform: (FocusConfig) -> FocusConfig) = error("unused")
    override suspend fun insertSession(session: FocusSession): Long = error("unused")
    override suspend fun updateSession(session: FocusSession) = error("unused")
    override suspend fun saveRunningState(state: FocusState?) = error("unused")
    override suspend fun loadRunningState(): FocusState? = error("unused")
}

class FakeBlockerRepository : BlockerRepository {
    val bypasses = MutableStateFlow<List<BypassSession>>(emptyList())
    override fun observeConfig(): Flow<BlockerConfig> = error("unused")
    override fun observeBlockedApps(): Flow<List<BlockedApp>> = error("unused")
    override fun observeBypasses(since: Instant): Flow<List<BypassSession>> = bypasses.map { l -> l.filter { !it.startedAt.isBefore(since) } }
    override suspend fun updateConfig(transform: (BlockerConfig) -> BlockerConfig) = error("unused")
    override suspend fun setBlockedApps(apps: List<BlockedApp>) = error("unused")
    override suspend fun setAppEnabled(packageName: String, enabled: Boolean) = error("unused")
    override suspend fun insertBypass(session: BypassSession): Long = error("unused")
    override suspend fun endBypassEarly(id: Long, at: Instant) = error("unused")
}

class FakeSettingsRepository(privacy: AiPrivacySettings = AiPrivacySettings()) : SettingsRepository {
    val privacy = MutableStateFlow(privacy)
    override fun observeSettings(): Flow<AppSettings> = error("unused")
    override fun observeAiPrivacy(): Flow<AiPrivacySettings> = this.privacy
    override suspend fun updateSettings(transform: (AppSettings) -> AppSettings) = error("unused")
    override suspend fun updateAiPrivacy(transform: (AiPrivacySettings) -> AiPrivacySettings) = this.privacy.update(transform)
}

class FakeChatRepository : ChatRepository {
    val messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    private var nextId = 1L
    override fun observeMessages(): Flow<List<ChatMessage>> = messages
    override suspend fun insertMessage(message: ChatMessage): Long {
        val id = nextId++
        messages.update { it + message.copy(id = id) }
        return id
    }
    override suspend fun updateMessage(message: ChatMessage) {
        messages.update { l -> l.map { if (it.id == message.id) message else it } }
    }
    override suspend fun countUserMessagesSince(since: Instant): Int =
        messages.value.count { it.role == ChatRole.USER && !it.createdAt.isBefore(since) }
    override suspend fun clear() { messages.value = emptyList() }
}
