package com.disciplineos.core.domain.task

import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.domain.repository.ReminderScheduler
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
import java.time.LocalDate
import javax.inject.Inject

/** Creates TaskOccurrence rows for a date window (idempotent). Called on app start, daily worker, and after edits. */
class OccurrenceMaterializer @Inject constructor(
    private val repo: TaskRepository,
    private val time: TimeProvider,
) {
    /** Default window: today-1 .. today+14. */
    suspend fun materializeWindow(from: LocalDate = time.today().minusDays(1), to: LocalDate = time.today().plusDays(14)): Unit = TODO()
    suspend fun rematerializeTask(taskId: Long): Unit = TODO()
    /** Past PENDING occurrences: optional → MISSED; mandatory stay PENDING if carry-over, else MISSED. */
    suspend fun sweepPast(carryOverMandatory: Boolean): Unit = TODO()
}

/** All task mutations go through here so validation, history, XP, reminders and blocker inputs stay consistent. */
class TaskCommands @Inject constructor(
    private val repo: TaskRepository,
    private val time: TimeProvider,
    private val materializer: OccurrenceMaterializer,
    private val gamification: GamificationService,
    private val reminders: ReminderScheduler,
) {
    suspend fun createTask(input: TaskInput): TaskResult<Long> = TODO()
    suspend fun updateTask(taskId: Long, input: TaskInput): TaskResult<Unit> = TODO()
    suspend fun deleteTask(taskId: Long): TaskResult<Unit> = TODO()
    suspend fun archiveTask(taskId: Long): TaskResult<Unit> = TODO()
    suspend fun completeOccurrence(occurrenceId: Long, verificationNote: String? = null): TaskResult<Unit> = TODO()
    suspend fun uncompleteOccurrence(occurrenceId: Long): TaskResult<Unit> = TODO()
    suspend fun snoozeOccurrence(occurrenceId: Long, minutes: Int): TaskResult<Unit> = TODO()
    suspend fun skipOccurrence(occurrenceId: Long, reason: String): TaskResult<Unit> = TODO()
    suspend fun toggleSubTask(subTaskId: Long, done: Boolean): Unit = TODO()
    suspend fun createCategory(name: String, colorHex: String, iconKey: String): TaskResult<Long> = TODO()
}

class ObserveDayPlanUseCase @Inject constructor(
    private val repo: TaskRepository,
    private val time: TimeProvider,
) {
    operator fun invoke(date: LocalDate = time.today()): Flow<DayPlan> = TODO()
}

class ObserveWeekUseCase @Inject constructor(
    private val repo: TaskRepository,
    private val time: TimeProvider,
) {
    /** 7 DayPlans starting at [weekStart]. */
    operator fun invoke(weekStart: LocalDate): Flow<List<DayPlan>> = TODO()
}

/** Greedy, deterministic scheduler: dependencies first, then mandatory, priority, deadline, estimate. */
object SmartScheduler {
    fun plan(items: List<OccurrenceWithTask>, windows: List<AvailabilityWindow>, defaultMinutes: Int = 30): WeeklyPlan = TODO()
}
