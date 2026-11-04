package com.disciplineos.app.data

import com.disciplineos.app.data.local.Converters
import com.disciplineos.app.data.local.entity.OccurrenceWithTaskRelation
import com.disciplineos.app.data.local.entity.SubTaskEntity
import com.disciplineos.app.data.local.entity.TaskOccurrenceEntity
import com.disciplineos.app.data.local.entity.TaskWithDependencies
import com.disciplineos.app.data.local.json.ChatActionsJson
import com.disciplineos.app.data.mapper.ReminderOffsetsCodec
import com.disciplineos.app.data.mapper.enumOr
import com.disciplineos.app.data.mapper.toEntity
import com.disciplineos.app.data.mapper.toModel
import com.disciplineos.core.model.ActionStatus
import com.disciplineos.core.model.ChatMessage
import com.disciplineos.core.model.ChatRole
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.ProposedAction
import com.disciplineos.core.model.RecurrenceRule
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskDraft
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.TaskOccurrence
import com.disciplineos.core.model.VerificationMethod
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MappersTest {

    private val now = Instant.parse("2026-11-04T08:00:00Z")

    private fun task() = Task(
        id = 7,
        title = "לרוץ 5 ק\"מ",
        notes = "notes",
        kind = TaskKind.MANDATORY,
        priority = Priority.HIGH,
        categoryId = 3,
        startDate = LocalDate.of(2026, 11, 1),
        dueTime = LocalTime.of(18, 30),
        endDate = LocalDate.of(2026, 12, 31),
        zoneId = "Asia/Jerusalem",
        recurrence = RecurrenceRule.Weekly(setOf(DayOfWeek.SUNDAY, DayOfWeek.TUESDAY)),
        reminderOffsetsMinutes = listOf(10, 60),
        estimatedMinutes = 45,
        verification = VerificationMethod.REFLECTION_NOTE,
        dependsOn = setOf(1, 2),
        archived = false,
        createdAt = now,
        updatedAt = now,
    )

    @Test
    fun task_roundTrips_throughEntity() {
        val t = task()
        val back = t.toEntity().toModel(t.dependsOn)
        // Offsets are normalised (sorted descending); everything else must be identical.
        assertEquals(t.copy(reminderOffsetsMinutes = listOf(60, 10)), back)
    }

    @Test
    fun enums_areStoredByName_andUnknownNamesFallBack() {
        val e = task().toEntity()
        assertEquals("MANDATORY", e.kind)
        assertEquals("HIGH", e.priority)
        val corrupted = e.copy(kind = "FUTURE_KIND", priority = "", verification = "X")
        val m = corrupted.toModel(emptySet())
        assertEquals(TaskKind.OPTIONAL, m.kind)
        assertEquals(Priority.MEDIUM, m.priority)
        assertEquals(VerificationMethod.NONE, m.verification)
        assertEquals(OccurrenceStatus.PENDING, enumOr<OccurrenceStatus>(null, OccurrenceStatus.PENDING))
    }

    @Test
    fun occurrence_roundTrips() {
        val o = TaskOccurrence(
            id = 11, taskId = 7, localDate = LocalDate.of(2026, 11, 4), dueAt = now, status = OccurrenceStatus.COMPLETED,
            completedAt = now, snoozedUntil = null, snoozeCount = 2, verificationNote = "done",
        )
        assertEquals(o, o.toEntity().toModel())
    }

    @Test
    fun relation_sortsSubTasksByPosition() {
        val t = task()
        val rel = OccurrenceWithTaskRelation(
            occurrence = TaskOccurrenceEntity(1, 7, LocalDate.of(2026, 11, 4), null, "PENDING", null, null),
            task = TaskWithDependencies(t.toEntity(), listOf(1L, 2L)),
            subTasks = listOf(
                SubTaskEntity(5, 7, "b", false, 1),
                SubTaskEntity(4, 7, "a", true, 0),
            ),
        )
        val m = rel.toModel()
        assertEquals(listOf("a", "b"), m.subTasks.map { it.title })
        assertEquals(setOf(1L, 2L), m.task.dependsOn)
        assertEquals(0, m.occurrence.snoozeCount)
    }

    @Test
    fun reminderOffsets_codecIsTolerant() {
        assertEquals("60,10", ReminderOffsetsCodec.encode(listOf(10, 60, 10)))
        assertEquals(listOf(60, 10), ReminderOffsetsCodec.decode("10, x,60,,10"))
        assertEquals(emptyList(), ReminderOffsetsCodec.decode(""))
        assertEquals(emptyList(), ReminderOffsetsCodec.decode(null))
    }

    @Test
    fun converters_handleExtremeDates() {
        val c = Converters()
        // TaskEngine queries with 1970-01-01 .. 9999-12-31.
        val min = LocalDate.of(1970, 1, 1)
        val max = LocalDate.of(9999, 12, 31)
        assertEquals(min, c.epochDayToLocalDate(c.localDateToEpochDay(min)))
        assertEquals(max, c.epochDayToLocalDate(c.localDateToEpochDay(max)))
        assertTrue(c.localDateToEpochDay(min)!! < c.localDateToEpochDay(max)!!)
        assertEquals(LocalTime.of(23, 59, 59), c.secondOfDayToLocalTime(c.localTimeToSecondOfDay(LocalTime.of(23, 59, 59))))
        assertEquals(now, c.millisToInstant(c.instantToMillis(now)))
        assertEquals(null, c.millisToInstant(null))
    }

    @Test
    fun chatMessage_actionsRoundTripAsJson() {
        val msg = ChatMessage(
            id = 3,
            role = ChatRole.ASSISTANT,
            text = "הצעה",
            createdAt = now,
            actions = listOf(
                ProposedAction.CreateTask(
                    TaskDraft("ללמוד", TaskKind.MANDATORY, Priority.HIGH, LocalDate.of(2026, 11, 5), LocalTime.of(9, 0), 30, listOf("פרק 1")),
                ),
                ProposedAction.RescheduleTask(taskId = 9, newDate = LocalDate.of(2026, 11, 6), status = ActionStatus.ACCEPTED),
            ),
        )
        val entity = msg.toEntity()
        assertTrue(entity.actionsJson.contains("\"type\":\"create_task\""))
        assertEquals(msg, entity.toModel())
    }

    @Test
    fun chatActions_corruptJsonDecodesToEmpty() {
        assertEquals(emptyList(), ChatActionsJson.decode("{not json"))
        assertEquals(emptyList(), ChatActionsJson.decode(""))
        // An action with an unparsable date is dropped, the others survive.
        val json = """[{"type":"reschedule_task","taskId":1,"newDate":"bad","status":"PROPOSED"},
            {"type":"reschedule_task","taskId":2,"newDate":"2026-11-06","status":"WHATEVER"}]"""
        val decoded = ChatActionsJson.decode(json)
        assertEquals(1, decoded.size)
        assertEquals(ActionStatus.INVALID, decoded.single().status)
    }
}
