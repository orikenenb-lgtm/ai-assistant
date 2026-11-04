package com.disciplineos.app.data.local.json

import com.disciplineos.app.data.mapper.enumOr
import com.disciplineos.core.model.ActionStatus
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.ProposedAction
import com.disciplineos.core.model.TaskDraft
import com.disciplineos.core.model.TaskKind
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.time.LocalDate
import java.time.LocalTime

/** Persistence DTOs for `ChatMessage.actions`. Kept separate from the domain model so the model stays annotation-free. */
@Serializable
sealed class ProposedActionDto {
    abstract val status: String

    @Serializable
    @SerialName("create_task")
    data class CreateTask(val draft: TaskDraftDto, override val status: String) : ProposedActionDto()

    @Serializable
    @SerialName("reschedule_task")
    data class RescheduleTask(val taskId: Long, val newDate: String, override val status: String) : ProposedActionDto()
}

@Serializable
data class TaskDraftDto(
    val title: String,
    val kind: String = TaskKind.OPTIONAL.name,
    val priority: String = Priority.MEDIUM.name,
    val date: String? = null,
    val time: String? = null,
    val estimatedMinutes: Int? = null,
    val subTasks: List<String> = emptyList(),
)

/** Pure (JVM-testable) codec. Unreadable JSON decodes to an empty list rather than crashing the chat screen. */
object ChatActionsJson {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        classDiscriminator = "type"
    }
    private val listSerializer = ListSerializer(ProposedActionDto.serializer())

    fun encode(actions: List<ProposedAction>): String =
        json.encodeToString(listSerializer, actions.map { it.toDto() })

    fun decode(value: String?): List<ProposedAction> {
        if (value.isNullOrBlank()) return emptyList()
        return try {
            json.decodeFromString(listSerializer, value).mapNotNull { it.toModelOrNull() }
        } catch (e: Exception) {
            // kotlinx.serialization throws SerializationException / IllegalArgumentException; content is not logged.
            emptyList()
        }
    }

    private fun ProposedAction.toDto(): ProposedActionDto = when (this) {
        is ProposedAction.CreateTask -> ProposedActionDto.CreateTask(
            draft = TaskDraftDto(
                title = draft.title,
                kind = draft.kind.name,
                priority = draft.priority.name,
                date = draft.date?.toString(),
                time = draft.time?.toString(),
                estimatedMinutes = draft.estimatedMinutes,
                subTasks = draft.subTasks,
            ),
            status = status.name,
        )
        is ProposedAction.RescheduleTask -> ProposedActionDto.RescheduleTask(
            taskId = taskId,
            newDate = newDate.toString(),
            status = status.name,
        )
    }

    private fun ProposedActionDto.toModelOrNull(): ProposedAction? = try {
        val st = enumOr(status, ActionStatus.INVALID)
        when (this) {
            is ProposedActionDto.CreateTask -> ProposedAction.CreateTask(
                draft = TaskDraft(
                    title = draft.title,
                    kind = enumOr(draft.kind, TaskKind.OPTIONAL),
                    priority = enumOr(draft.priority, Priority.MEDIUM),
                    date = draft.date?.let(LocalDate::parse),
                    time = draft.time?.let(LocalTime::parse),
                    estimatedMinutes = draft.estimatedMinutes,
                    subTasks = draft.subTasks,
                ),
                status = st,
            )
            is ProposedActionDto.RescheduleTask -> ProposedAction.RescheduleTask(
                taskId = taskId,
                newDate = LocalDate.parse(newDate),
                status = st,
            )
        }
    } catch (e: java.time.format.DateTimeParseException) {
        null
    }
}
