package com.disciplineos.core.domain.task

import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.domain.repository.ReminderScheduler
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject

/** Creates TaskOccurrence rows for a date window (idempotent). Called on app start, daily worker, and after edits. */
class OccurrenceMaterializer @Inject constructor(
    private val repo: TaskRepository,
    private val time: TimeProvider,
) {
    /** Default window: today-1 .. today+14. */
    suspend fun materializeWindow(from: LocalDate = time.today().minusDays(1), to: LocalDate = time.today().plusDays(14)) {
        if (from.isAfter(to)) return
        val occurrences = repo.getAllActiveTasks()
            .filter { !it.archived }
            .flatMap { task -> buildOccurrences(task, RecurrenceEngine.occurrenceDates(task, from, to)) }
        if (occurrences.isNotEmpty()) repo.insertOccurrencesIfAbsent(occurrences)
    }

    /**
     * Regenerates the future of one task after an edit: PENDING occurrences from today forward are deleted and
     * recreated from the current rule (window today..today+[WINDOW_DAYS]). Completed/skipped/missed history is never
     * touched. Snooze state of a regenerated occurrence on the same date is carried over so editing a task cannot be
     * used to reset the snooze limit.
     *
     * One-off tasks are handled as a whole: their single PENDING occurrence is moved to the new start date (even if
     * it was in the past), and no new occurrence is created once the task was completed or skipped. The moved
     * occurrence keeps its snooze count, so changing the start date cannot reset the snooze limit either.
     */
    suspend fun rematerializeTask(taskId: Long) {
        val task = repo.getTask(taskId) ?: return
        val today = time.today()
        if (task.recurrence == RecurrenceRule.None) {
            val all = repo.getOccurrences(taskId, FAR_PAST, FAR_FUTURE)
            val pending = all.filter { it.status == OccurrenceStatus.PENDING }
            pending.minOfOrNull { it.localDate }?.let { repo.deletePendingOccurrencesFrom(taskId, it) }
            if (task.archived) return
            val resolved = all.any { it.status == OccurrenceStatus.COMPLETED || it.status == OccurrenceStatus.SKIPPED }
            if (resolved) return
            val dates = RecurrenceEngine.occurrenceDates(task, task.startDate, task.startDate)
            // Same date: full snooze state carries over. Moved to another date: the snooze *count* still carries over
            // (moving the start date must not reset the snooze limit); a pending snooze-until instant does not.
            val carriedCount = pending.maxOfOrNull { it.snoozeCount } ?: 0
            val fresh = carrySnooze(buildOccurrences(task, dates), pending)
                .map { if (it.snoozeCount < carriedCount) it.copy(snoozeCount = carriedCount) else it }
            if (fresh.isNotEmpty()) repo.insertOccurrencesIfAbsent(fresh)
            return
        }
        val end = today.plusDays(WINDOW_DAYS)
        val previous = repo.getOccurrences(taskId, today, FAR_FUTURE).filter { it.status == OccurrenceStatus.PENDING }
        repo.deletePendingOccurrencesFrom(taskId, today)
        if (task.archived) return
        val fresh = carrySnooze(buildOccurrences(task, RecurrenceEngine.occurrenceDates(task, today, end)), previous)
        if (fresh.isNotEmpty()) repo.insertOccurrencesIfAbsent(fresh)
    }

    /**
     * Past PENDING occurrences (local date before today): optional → MISSED; mandatory stay PENDING if carry-over,
     * else MISSED. Each transition is recorded in the task history. Idempotent.
     */
    suspend fun sweepPast(carryOverMandatory: Boolean) {
        val today = time.today()
        val now = time.now()
        val open = repo.observeOpenOccurrences(today.minusDays(1)).first()
        for (item in open) {
            val occ = item.occurrence
            if (occ.status != OccurrenceStatus.PENDING || !occ.localDate.isBefore(today)) continue
            if (item.task.kind == TaskKind.MANDATORY && carryOverMandatory) continue
            repo.updateOccurrence(occ.copy(status = OccurrenceStatus.MISSED, snoozedUntil = null))
            repo.appendHistory(
                TaskHistoryEntry(taskId = occ.taskId, occurrenceId = occ.id, type = TaskHistoryType.MISSED, at = now,
                    detail = "date=${occ.localDate}")
            )
        }
    }

    private fun buildOccurrences(task: Task, dates: List<LocalDate>): List<TaskOccurrence> {
        val zone = task.zoneOrDefault(time.zone())
        return dates.map { d ->
            TaskOccurrence(taskId = task.id, localDate = d, dueAt = DueInstantResolver.resolve(d, task.dueTime, zone))
        }
    }

    private fun carrySnooze(fresh: List<TaskOccurrence>, previous: List<TaskOccurrence>): List<TaskOccurrence> {
        if (previous.isEmpty()) return fresh
        val now = time.now()
        val byDate = previous.associateBy { it.localDate }
        return fresh.map { occ ->
            val old = byDate[occ.localDate] ?: return@map occ
            occ.copy(
                snoozeCount = old.snoozeCount,
                snoozedUntil = old.snoozedUntil?.takeIf { it.isAfter(now) },
            )
        }
    }

    companion object {
        const val WINDOW_DAYS = 14L
        internal val FAR_PAST: LocalDate = LocalDate.of(1970, 1, 1)
        internal val FAR_FUTURE: LocalDate = LocalDate.of(9999, 12, 31)
    }
}

/** All task mutations go through here so validation, history, XP, reminders and blocker inputs stay consistent. */
class TaskCommands internal constructor(
    private val repo: TaskRepository,
    private val time: TimeProvider,
    private val materializer: OccurrenceMaterializer,
    private val onCompleted: suspend (Task, TaskOccurrence) -> Unit,
    private val onDayCheck: suspend (LocalDate) -> Unit,
    private val reminders: ReminderScheduler,
) {
    @Inject constructor(
        repo: TaskRepository,
        time: TimeProvider,
        materializer: OccurrenceMaterializer,
        gamification: GamificationService,
        reminders: ReminderScheduler,
    ) : this(
        repo = repo,
        time = time,
        materializer = materializer,
        onCompleted = { task, occurrence -> gamification.onOccurrenceCompleted(task, occurrence) },
        onDayCheck = { date -> gamification.checkDayCleared(date) },
        reminders = reminders,
    )

    suspend fun createTask(input: TaskInput): TaskResult<Long> {
        val valid = when (val v = validate(input, editedTaskId = null)) {
            is TaskResult.Failure -> return v
            is TaskResult.Success -> v.value
        }
        val now = time.now()
        val task = Task(
            title = valid.title,
            notes = valid.notes,
            kind = input.kind,
            priority = input.priority,
            categoryId = input.categoryId,
            startDate = input.startDate,
            dueTime = input.dueTime,
            endDate = input.endDate,
            zoneId = time.zone().id,
            recurrence = input.recurrence,
            reminderOffsetsMinutes = valid.reminders,
            estimatedMinutes = input.estimatedMinutes,
            verification = input.verification,
            dependsOn = input.dependsOn,
            createdAt = now,
            updatedAt = now,
        )
        val id = repo.upsertTask(task)
        repo.replaceSubTasks(id, valid.subTasks.mapIndexed { i, t -> SubTask(taskId = id, title = t, position = i) })
        history(id, null, TaskHistoryType.CREATED)
        materializer.rematerializeTask(id)
        reminders.rescheduleAll()
        return TaskResult.Success(id)
    }

    suspend fun updateTask(taskId: Long, input: TaskInput): TaskResult<Unit> {
        val existing = repo.getTask(taskId) ?: return TaskResult.Failure(TaskError.NOT_FOUND)
        val valid = when (val v = validate(input, editedTaskId = taskId)) {
            is TaskResult.Failure -> return v
            is TaskResult.Success -> v.value
        }
        val updated = existing.copy(
            title = valid.title,
            notes = valid.notes,
            kind = input.kind,
            priority = input.priority,
            categoryId = input.categoryId,
            startDate = input.startDate,
            dueTime = input.dueTime,
            endDate = input.endDate,
            recurrence = input.recurrence,
            reminderOffsetsMinutes = valid.reminders,
            estimatedMinutes = input.estimatedMinutes,
            verification = input.verification,
            dependsOn = input.dependsOn,
            updatedAt = time.now(),
        )
        repo.upsertTask(updated)

        // Keep done-state (and ids) of subtasks whose title survived the edit.
        val current = repo.observeSubTasks(taskId).first().sortedBy { it.position }.toMutableList()
        val newSubTasks = valid.subTasks.mapIndexed { i, title ->
            val match = current.firstOrNull { it.title == title }
            if (match != null) current.remove(match)
            SubTask(id = match?.id ?: 0, taskId = taskId, title = title, done = match?.done ?: false, position = i)
        }
        repo.replaceSubTasks(taskId, newSubTasks)

        history(taskId, null, TaskHistoryType.EDITED)
        val scheduleChanged = existing.startDate != updated.startDate || existing.endDate != updated.endDate ||
            existing.recurrence != updated.recurrence || existing.dueTime != updated.dueTime
        if (scheduleChanged) materializer.rematerializeTask(taskId)
        reminders.rescheduleAll()
        return TaskResult.Success(Unit)
    }

    suspend fun deleteTask(taskId: Long): TaskResult<Unit> {
        repo.getTask(taskId) ?: return TaskResult.Failure(TaskError.NOT_FOUND)
        history(taskId, null, TaskHistoryType.DELETED)
        // Drop dangling dependency edges so dependents do not stay blocked by a task that no longer exists.
        val now = time.now()
        for (t in repo.observeTasks(includeArchived = true).first()) {
            if (t.id != taskId && taskId in t.dependsOn) {
                repo.upsertTask(t.copy(dependsOn = t.dependsOn - taskId, updatedAt = now))
            }
        }
        repo.deleteTask(taskId)
        reminders.cancelForTask(taskId)
        return TaskResult.Success(Unit)
    }

    suspend fun archiveTask(taskId: Long): TaskResult<Unit> {
        val task = repo.getTask(taskId) ?: return TaskResult.Failure(TaskError.NOT_FOUND)
        if (task.archived) return TaskResult.Success(Unit)
        repo.upsertTask(task.copy(archived = true, updatedAt = time.now()))
        repo.deletePendingOccurrencesFrom(taskId, time.today())
        history(taskId, null, TaskHistoryType.ARCHIVED)
        reminders.rescheduleAll()
        return TaskResult.Success(Unit)
    }

    suspend fun completeOccurrence(occurrenceId: Long, verificationNote: String? = null): TaskResult<Unit> {
        val occ = repo.getOccurrence(occurrenceId) ?: return TaskResult.Failure(TaskError.NOT_FOUND)
        val task = repo.getTask(occ.taskId) ?: return TaskResult.Failure(TaskError.NOT_FOUND)
        if (occ.status == OccurrenceStatus.COMPLETED || occ.status == OccurrenceStatus.SKIPPED) {
            return TaskResult.Failure(TaskError.ALREADY_RESOLVED)
        }
        if (!dependenciesResolved(task, occ.localDate)) return TaskResult.Failure(TaskError.DEPENDENCIES_INCOMPLETE)

        val note = verificationNote?.trim()?.takeIf { it.isNotEmpty() }
        if (note != null && note.length > MAX_NOTES) return TaskResult.Failure(TaskError.NOTES_TOO_LONG)
        when (task.verification) {
            VerificationMethod.NONE, VerificationMethod.FOCUS_TIMER -> Unit // self-reported
            VerificationMethod.CHECKLIST ->
                if (!repo.observeSubTasks(task.id).first().all { it.done }) {
                    return TaskResult.Failure(TaskError.VERIFICATION_REQUIRED)
                }
            VerificationMethod.REFLECTION_NOTE ->
                if (note == null || note.length < MIN_REFLECTION) return TaskResult.Failure(TaskError.VERIFICATION_REQUIRED)
        }

        val now = time.now()
        val completed = occ.copy(
            status = OccurrenceStatus.COMPLETED,
            completedAt = now,
            snoozedUntil = null,
            verificationNote = note,
        )
        repo.updateOccurrence(completed)
        history(task.id, occ.id, TaskHistoryType.COMPLETED, if (occ.status == OccurrenceStatus.MISSED) "late" else "")
        onCompleted(task, completed)
        onDayCheck(occ.localDate)
        reminders.rescheduleAll()
        return TaskResult.Success(Unit)
    }

    /** Reverts a COMPLETED or SKIPPED occurrence to PENDING. XP is never revoked (awards are idempotent by key). */
    suspend fun uncompleteOccurrence(occurrenceId: Long): TaskResult<Unit> {
        val occ = repo.getOccurrence(occurrenceId) ?: return TaskResult.Failure(TaskError.NOT_FOUND)
        if (occ.status != OccurrenceStatus.COMPLETED && occ.status != OccurrenceStatus.SKIPPED) {
            return TaskResult.Failure(TaskError.ALREADY_RESOLVED)
        }
        repo.updateOccurrence(occ.copy(status = OccurrenceStatus.PENDING, completedAt = null, verificationNote = null))
        history(occ.taskId, occ.id, TaskHistoryType.UNCOMPLETED, "from=${occ.status}")
        reminders.rescheduleAll()
        return TaskResult.Success(Unit)
    }

    suspend fun snoozeOccurrence(occurrenceId: Long, minutes: Int): TaskResult<Unit> {
        if (minutes !in SNOOZE_MINUTES) return TaskResult.Failure(TaskError.INVALID_SNOOZE)
        val occ = repo.getOccurrence(occurrenceId) ?: return TaskResult.Failure(TaskError.NOT_FOUND)
        if (occ.status != OccurrenceStatus.PENDING) return TaskResult.Failure(TaskError.ALREADY_RESOLVED)
        if (occ.snoozeCount >= MAX_SNOOZES) return TaskResult.Failure(TaskError.SNOOZE_LIMIT_REACHED)
        val until = time.now().plusSeconds(minutes * 60L)
        repo.updateOccurrence(occ.copy(snoozedUntil = until, snoozeCount = occ.snoozeCount + 1))
        history(occ.taskId, occ.id, TaskHistoryType.SNOOZED, "minutes=$minutes;until=$until")
        reminders.rescheduleAll()
        return TaskResult.Success(Unit)
    }

    /**
     * Skips an open (PENDING or MISSED) occurrence with a mandatory justification. No XP and no day-cleared check are
     * triggered. A blank reason fails with [TaskError.VERIFICATION_REQUIRED] (the reason is the skip's "proof").
     */
    suspend fun skipOccurrence(occurrenceId: Long, reason: String): TaskResult<Unit> {
        val trimmed = reason.trim()
        if (trimmed.isEmpty()) return TaskResult.Failure(TaskError.VERIFICATION_REQUIRED)
        if (trimmed.length > MAX_SKIP_REASON) return TaskResult.Failure(TaskError.NOTES_TOO_LONG)
        val occ = repo.getOccurrence(occurrenceId) ?: return TaskResult.Failure(TaskError.NOT_FOUND)
        if (occ.status == OccurrenceStatus.COMPLETED || occ.status == OccurrenceStatus.SKIPPED) {
            return TaskResult.Failure(TaskError.ALREADY_RESOLVED)
        }
        repo.updateOccurrence(occ.copy(status = OccurrenceStatus.SKIPPED, snoozedUntil = null, verificationNote = trimmed))
        history(occ.taskId, occ.id, TaskHistoryType.SKIPPED, trimmed)
        reminders.rescheduleAll()
        return TaskResult.Success(Unit)
    }

    suspend fun toggleSubTask(subTaskId: Long, done: Boolean) {
        repo.setSubTaskDone(subTaskId, done)
    }

    /**
     * Name: trimmed, 1..[MAX_CATEGORY_NAME] chars. An invalid colour (not `#RRGGBB`/`#AARRGGBB`) falls back to
     * [DEFAULT_CATEGORY_COLOR]; a blank icon key falls back to `"default"`.
     */
    suspend fun createCategory(name: String, colorHex: String, iconKey: String): TaskResult<Long> {
        val n = name.trim()
        if (n.isEmpty()) return TaskResult.Failure(TaskError.TITLE_BLANK)
        if (n.length > MAX_CATEGORY_NAME) return TaskResult.Failure(TaskError.TITLE_TOO_LONG)
        val color = colorHex.trim().takeIf { COLOR_REGEX.matches(it) }?.uppercase() ?: DEFAULT_CATEGORY_COLOR
        val icon = iconKey.trim().ifEmpty { "default" }
        return TaskResult.Success(repo.upsertCategory(Category(name = n, colorHex = color, iconKey = icon)))
    }

    // ---------------------------------------------------------------------------------------------------------------

    private data class ValidInput(val title: String, val notes: String, val reminders: List<Int>, val subTasks: List<String>)

    private suspend fun validate(input: TaskInput, editedTaskId: Long?): TaskResult<ValidInput> {
        fun fail(e: TaskError) = TaskResult.Failure(e)
        val title = input.title.trim()
        if (title.isEmpty()) return fail(TaskError.TITLE_BLANK)
        if (title.length > MAX_TITLE) return fail(TaskError.TITLE_TOO_LONG)
        val notes = input.notes.trim()
        if (notes.length > MAX_NOTES) return fail(TaskError.NOTES_TOO_LONG)
        if (input.endDate != null && input.endDate.isBefore(input.startDate)) return fail(TaskError.INVALID_DATE_RANGE)
        val reminders = input.reminderOffsetsMinutes.distinct().sorted()
        if (input.reminderOffsetsMinutes.size > MAX_REMINDERS || reminders.any { it !in REMINDER_RANGE }) {
            return fail(TaskError.INVALID_REMINDER)
        }
        if (input.estimatedMinutes != null && input.estimatedMinutes !in ESTIMATE_RANGE) return fail(TaskError.INVALID_ESTIMATE)
        val subTasks = input.subTasks.map { it.trim() }.filter { it.isNotEmpty() }
        if (subTasks.size > MAX_SUBTASKS) return fail(TaskError.TOO_MANY_SUBTASKS)
        if (subTasks.any { it.length > MAX_TITLE }) return fail(TaskError.TITLE_TOO_LONG)

        if (editedTaskId != null && editedTaskId in input.dependsOn) return fail(TaskError.DEPENDENCY_CYCLE)
        for (dep in input.dependsOn) {
            if (repo.getTask(dep) == null) return fail(TaskError.DEPENDENCY_NOT_FOUND)
        }
        if (editedTaskId != null && createsCycle(editedTaskId, input.dependsOn)) return fail(TaskError.DEPENDENCY_CYCLE)
        return TaskResult.Success(ValidInput(title, notes, reminders, subTasks))
    }

    /** Iterative DFS over the dependsOn graph, with [taskId]'s edges replaced by [newDeps]. */
    private suspend fun createsCycle(taskId: Long, newDeps: Set<Long>): Boolean {
        val visited = HashSet<Long>()
        val stack = ArrayDeque(newDeps)
        while (stack.isNotEmpty()) {
            val id = stack.removeLast()
            if (id == taskId) return true
            if (!visited.add(id)) continue
            val next = repo.getTask(id)?.dependsOn ?: continue
            next.forEach { stack.addLast(it) }
        }
        return false
    }

    /**
     * A dependency is resolved when:
     * - one-off dependency: it has any COMPLETED occurrence;
     * - recurring dependency: its occurrence on the same local date is COMPLETED or SKIPPED, or the dependency simply
     *   does not occur on that date (nothing to wait for).
     * Dependencies that no longer exist are ignored.
     */
    private suspend fun dependenciesResolved(task: Task, date: LocalDate): Boolean {
        for (depId in task.dependsOn) {
            val dep = repo.getTask(depId) ?: continue
            val ok = if (dep.recurrence == RecurrenceRule.None) {
                repo.getOccurrences(depId, OccurrenceMaterializer.FAR_PAST, OccurrenceMaterializer.FAR_FUTURE)
                    .any { it.status == OccurrenceStatus.COMPLETED }
            } else {
                val sameDay = repo.getOccurrences(depId, date, date)
                if (sameDay.isEmpty()) {
                    RecurrenceEngine.occurrenceDates(dep.copy(archived = false), date, date).isEmpty()
                } else {
                    sameDay.any { it.status == OccurrenceStatus.COMPLETED || it.status == OccurrenceStatus.SKIPPED }
                }
            }
            if (!ok) return false
        }
        return true
    }

    private suspend fun history(taskId: Long, occurrenceId: Long?, type: TaskHistoryType, detail: String = "") {
        repo.appendHistory(TaskHistoryEntry(taskId = taskId, occurrenceId = occurrenceId, type = type, at = time.now(), detail = detail))
    }

    companion object {
        const val MAX_TITLE = 120
        const val MAX_NOTES = 2000
        const val MAX_REMINDERS = 5
        val REMINDER_RANGE = 0..10080
        val ESTIMATE_RANGE = 1..720
        const val MAX_SUBTASKS = 30
        val SNOOZE_MINUTES = 5..1440
        const val MAX_SNOOZES = 3
        const val MIN_REFLECTION = 10
        const val MAX_SKIP_REASON = 500
        const val MAX_CATEGORY_NAME = 40
        const val DEFAULT_CATEGORY_COLOR = "#7C4DFF"
        private val COLOR_REGEX = Regex("^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$")
    }
}

/** Builds a [DayPlan] from raw occurrence lists. Shared by the day and week use cases. */
internal object DayPlanBuilder {
    /**
     * @param dayItems occurrences whose localDate == [date]
     * @param openItems open occurrences on earlier dates (any status; filtered here)
     * @param today overdue = PENDING mandatory with localDate < min(date, today). For past/current days this is
     *   exactly "earlier than [date]"; for future days only items that are already overdue now are carried.
     */
    fun build(date: LocalDate, today: LocalDate, dayItems: List<OccurrenceWithTask>, openItems: List<OccurrenceWithTask>, fallbackZone: ZoneId): DayPlan {
        val cutoff = minOf(date, today)
        val comparator = planComparator(fallbackZone)
        val day = dayItems.filter { it.occurrence.localDate == date }.distinctBy { it.occurrence.id }
        val dayIds = day.mapTo(HashSet()) { it.occurrence.id }
        val overdue = openItems.asSequence()
            .filter { it.occurrence.status == OccurrenceStatus.PENDING }
            .filter { it.task.kind == TaskKind.MANDATORY && !it.task.archived }
            .filter { it.occurrence.localDate.isBefore(cutoff) && it.occurrence.id !in dayIds }
            .distinctBy { it.occurrence.id }
            .sortedWith(comparator)
            .toList()
        return DayPlan(
            date = date,
            mandatory = day.filter { it.task.kind == TaskKind.MANDATORY }.sortedWith(comparator),
            optional = day.filter { it.task.kind == TaskKind.OPTIONAL }.sortedWith(comparator),
            overdue = overdue,
            completedCount = day.count { it.occurrence.status == OccurrenceStatus.COMPLETED },
            totalCount = day.count { it.occurrence.status != OccurrenceStatus.SKIPPED },
        )
    }

    /** Mandatory first, priority desc, effective due asc (no time = end of day), then title and id for stability. */
    fun planComparator(fallbackZone: ZoneId): Comparator<OccurrenceWithTask> =
        compareBy<OccurrenceWithTask> { if (it.task.kind == TaskKind.MANDATORY) 0 else 1 }
            .thenByDescending { it.task.priority.weight }
            .thenBy { it.occurrence.dueAt ?: DueInstantResolver.endOfDay(it.occurrence.localDate, it.task.zoneOrDefault(fallbackZone)) }
            .thenBy { it.task.title }
            .thenBy { it.occurrence.id }
}

class ObserveDayPlanUseCase @Inject constructor(
    private val repo: TaskRepository,
    private val time: TimeProvider,
) {
    operator fun invoke(date: LocalDate = time.today()): Flow<DayPlan> =
        combine(repo.observeOccurrences(date, date), repo.observeOpenOccurrences(date.minusDays(1))) { day, open ->
            DayPlanBuilder.build(date, time.today(), day, open, time.zone())
        }.distinctUntilChanged()
}

class ObserveWeekUseCase @Inject constructor(
    private val repo: TaskRepository,
    private val time: TimeProvider,
) {
    /** 7 DayPlans starting at [weekStart]. */
    operator fun invoke(weekStart: LocalDate): Flow<List<DayPlan>> {
        val weekEnd = weekStart.plusDays(6)
        return combine(repo.observeOccurrences(weekStart, weekEnd), repo.observeOpenOccurrences(weekEnd.minusDays(1))) { week, open ->
            val today = time.today()
            val byDate = week.groupBy { it.occurrence.localDate }
            (0L..6L).map { i ->
                val d = weekStart.plusDays(i)
                DayPlanBuilder.build(d, today, byDate[d].orEmpty(), open, time.zone())
            }
        }.distinctUntilChanged()
    }
}

/** Greedy, deterministic scheduler: dependencies first, then mandatory, priority, deadline, estimate. */
object SmartScheduler {
    /**
     * - Only PENDING occurrences are planned; others are ignored (neither scheduled nor unscheduled).
     * - Order: topological on dependencies (B after A when B's task depends on A's task and A is a one-off or on the
     *   same local date), ties broken by mandatory, priority desc, earliest due, shorter estimate, occurrence id.
     *   Members of a dependency cycle are appended in tie-break order.
     * - Placement: earliest free slot in an availability window dated on/after the occurrence date, never
     *   overlapping another block, and starting after the end of every scheduled in-set dependency.
     *   Overlapping windows on the same date are merged.
     * - An occurrence that does not fit — or whose in-set dependency could not be placed — is unscheduled.
     */
    fun plan(items: List<OccurrenceWithTask>, windows: List<AvailabilityWindow>, defaultMinutes: Int = 30): WeeklyPlan {
        val pending = items.filter { it.occurrence.status == OccurrenceStatus.PENDING }.distinctBy { it.occurrence.id }
        if (pending.isEmpty()) return WeeklyPlan(emptyList(), emptyList())
        val fallbackMinutes = defaultMinutes.coerceIn(1, MINUTES_PER_DAY)

        val tieBreak = compareBy<OccurrenceWithTask> { if (it.task.kind == TaskKind.MANDATORY) 0 else 1 }
            .thenByDescending { it.task.priority.weight }
            .thenBy { it.occurrence.dueAt ?: DueInstantResolver.endOfDay(it.occurrence.localDate, it.task.zoneOrDefault(ZoneId.of("UTC"))) }
            .thenBy { it.task.estimatedMinutes ?: fallbackMinutes }
            .thenBy { it.occurrence.id }

        // Dependency edges between occurrences of this plan.
        val prerequisites: Map<Long, List<Long>> = pending.associate { b ->
            b.occurrence.id to pending.filter { a ->
                a.occurrence.id != b.occurrence.id && a.task.id in b.task.dependsOn &&
                    (a.task.recurrence == RecurrenceRule.None || a.occurrence.localDate == b.occurrence.localDate)
            }.map { it.occurrence.id }
        }
        val ordered = topoOrder(pending, prerequisites, tieBreak)

        val free = buildFreeSlots(windows)
        val placed = HashMap<Long, ScheduledBlock>()
        val failed = HashSet<Long>()
        val unscheduled = ArrayList<Long>()

        for (item in ordered) {
            val occId = item.occurrence.id
            val prereqs = prerequisites[occId].orEmpty()
            if (prereqs.any { it in failed }) {
                failed += occId; unscheduled += occId; continue
            }
            val after = prereqs.mapNotNull { placed[it] }.maxWithOrNull(compareBy({ it.date }, { it.end }))
            val minutes = (item.task.estimatedMinutes ?: fallbackMinutes).coerceAtLeast(1)
            val block = place(free, item, minutes, after)
            if (block == null) {
                failed += occId; unscheduled += occId
            } else {
                placed[occId] = block
            }
        }
        val blocks = placed.values.sortedWith(compareBy({ it.date }, { it.start }, { it.occurrenceId }))
        return WeeklyPlan(blocks, unscheduled)
    }

    private const val MINUTES_PER_DAY = 24 * 60

    private class Slot(val date: LocalDate, var start: Int, var end: Int)

    private fun buildFreeSlots(windows: List<AvailabilityWindow>): MutableList<Slot> {
        val result = ArrayList<Slot>()
        windows.map { Triple(it.date, ceilMinute(it.start), ceilMinute(it.end)) }
            .filter { it.third > it.second }
            .sortedWith(compareBy({ it.first }, { it.second }))
            .forEach { (date, s, e) ->
                val last = result.lastOrNull()
                if (last != null && last.date == date && s <= last.end) last.end = maxOf(last.end, e)
                else result += Slot(date, s, e)
            }
        return result
    }

    /** Rounds up to whole minutes so a block never starts before availability; LocalTime.MAX → 1440. */
    private fun ceilMinute(t: java.time.LocalTime): Int = ((t.toNanoOfDay() + NANOS_PER_MINUTE - 1) / NANOS_PER_MINUTE).toInt()
    private const val NANOS_PER_MINUTE = 60_000_000_000L

    private fun place(free: MutableList<Slot>, item: OccurrenceWithTask, minutes: Int, after: ScheduledBlock?): ScheduledBlock? {
        val earliestDate = maxOf(item.occurrence.localDate, after?.date ?: LocalDate.MIN)
        for ((index, slot) in free.withIndex()) {
            if (slot.date.isBefore(earliestDate)) continue
            val minStart = if (after != null && after.date == slot.date) ceilMinute(after.end) else 0
            val start = maxOf(slot.start, minStart)
            val end = start + minutes
            if (end > slot.end) continue
            // Split the free slot around [start, end).
            val tail = Slot(slot.date, end, slot.end)
            if (start > slot.start) {
                slot.end = start
                if (tail.end > tail.start) free.add(index + 1, tail)
            } else {
                if (tail.end > tail.start) { slot.start = tail.start } else free.removeAt(index)
            }
            return ScheduledBlock(
                occurrenceId = item.occurrence.id,
                taskId = item.task.id,
                date = slot.date,
                start = minuteToTime(start),
                end = minuteToTime(end),
            )
        }
        return null
    }

    /** Minutes since midnight → LocalTime; 1440 (exact end of day) maps to 23:59:59.999999999. */
    private fun minuteToTime(m: Int): java.time.LocalTime =
        if (m >= MINUTES_PER_DAY) java.time.LocalTime.MAX else java.time.LocalTime.of(m / 60, m % 60)

    private fun topoOrder(
        nodes: List<OccurrenceWithTask>,
        prerequisites: Map<Long, List<Long>>,
        tieBreak: Comparator<OccurrenceWithTask>,
    ): List<OccurrenceWithTask> {
        val byId = nodes.associateBy { it.occurrence.id }
        val indegree = HashMap<Long, Int>()
        val dependents = HashMap<Long, MutableList<Long>>()
        for (n in nodes) indegree[n.occurrence.id] = prerequisites[n.occurrence.id].orEmpty().size
        for ((b, pres) in prerequisites) for (a in pres) dependents.getOrPut(a) { ArrayList() } += b
        val ready = java.util.PriorityQueue(tieBreak)
        nodes.filter { indegree[it.occurrence.id] == 0 }.forEach { ready += it }
        val out = ArrayList<OccurrenceWithTask>(nodes.size)
        val emitted = HashSet<Long>()
        while (ready.isNotEmpty()) {
            val n = ready.poll()
            out += n; emitted += n.occurrence.id
            for (d in dependents[n.occurrence.id].orEmpty()) {
                val left = indegree.getValue(d) - 1
                indegree[d] = left
                if (left == 0) ready += byId.getValue(d)
            }
        }
        if (out.size < nodes.size) out += nodes.filter { it.occurrence.id !in emitted }.sortedWith(tieBreak)
        return out
    }
}

/** The task's own zone; falls back to [fallback] if the stored id is invalid. */
internal fun Task.zoneOrDefault(fallback: ZoneId): ZoneId =
    try { ZoneId.of(zoneId) } catch (e: Exception) { fallback }
