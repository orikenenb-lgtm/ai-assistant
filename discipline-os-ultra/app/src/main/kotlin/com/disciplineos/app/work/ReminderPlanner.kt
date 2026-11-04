package com.disciplineos.app.work

import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.OccurrenceWithTask
import java.time.DateTimeException
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** One reminder to schedule. [offsetKey] is the offset in minutes, or [SNOOZE_KEY] for a snooze wake-up. */
data class ReminderSpec(
    val occurrenceId: Long,
    val taskId: Long,
    val offsetKey: String,
    val fireAt: Instant,
) {
    /** Unique WorkManager name (contract): "reminder-<occurrenceId>-<offset>". */
    val uniqueName: String get() = "reminder-$occurrenceId-$offsetKey"

    companion object {
        const val SNOOZE_KEY = "snooze"
    }
}

/**
 * Pure reminder planning (JVM-tested). For every PENDING occurrence of a non-archived task:
 * - deadline = `dueAt`, or end of the local day in the task's zone when no time is set;
 * - one reminder per offset at `deadline - offset`, kept only when it lies in (now, now + horizon];
 * - a snoozed occurrence (snoozedUntil > now) gets one wake-up at `snoozedUntil`, and offset reminders that
 *   would fire before it are dropped (the user explicitly asked for quiet until then).
 */
object ReminderPlanner {
    val DEFAULT_HORIZON: Duration = Duration.ofHours(48)
    private const val MAX_OFFSET_MINUTES = 7 * 24 * 60

    fun plan(
        items: List<OccurrenceWithTask>,
        now: Instant,
        horizon: Duration = DEFAULT_HORIZON,
        endOfDay: (LocalDate, ZoneId) -> Instant,
    ): List<ReminderSpec> {
        val limit = now.plus(horizon)
        val out = ArrayList<ReminderSpec>()
        for (item in items) {
            val occ = item.occurrence
            val task = item.task
            if (occ.status != OccurrenceStatus.PENDING || task.archived) continue

            val snoozedUntil = occ.snoozedUntil?.takeIf { it.isAfter(now) }
            if (snoozedUntil != null && !snoozedUntil.isAfter(limit)) {
                out += ReminderSpec(occ.id, task.id, ReminderSpec.SNOOZE_KEY, snoozedUntil)
            }
            if (task.reminderOffsetsMinutes.isEmpty()) continue

            val zone = try { ZoneId.of(task.zoneId) } catch (e: DateTimeException) { ZoneId.systemDefault() }
            val deadline = occ.dueAt ?: endOfDay(occ.localDate, zone)
            for (offset in task.reminderOffsetsMinutes.distinct()) {
                if (offset !in 0..MAX_OFFSET_MINUTES) continue
                val fireAt = deadline.minus(Duration.ofMinutes(offset.toLong()))
                if (!fireAt.isAfter(now) || fireAt.isAfter(limit)) continue
                if (snoozedUntil != null && fireAt.isBefore(snoozedUntil)) continue
                out += ReminderSpec(occ.id, task.id, offset.toString(), fireAt)
            }
        }
        return out.sortedBy { it.fireAt }
    }
}
