package com.disciplineos.core.model

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

enum class ChatRole { USER, ASSISTANT, NOTICE }

enum class ActionStatus { PROPOSED, ACCEPTED, REJECTED, INVALID }

/** A task the coach suggests. It is only ever written after explicit user approval. */
data class TaskDraft(
    val title: String,
    val kind: TaskKind = TaskKind.OPTIONAL,
    val priority: Priority = Priority.MEDIUM,
    val date: LocalDate? = null,
    val time: LocalTime? = null,
    val estimatedMinutes: Int? = null,
    val subTasks: List<String> = emptyList(),
)

sealed interface ProposedAction {
    val status: ActionStatus
    data class CreateTask(val draft: TaskDraft, override val status: ActionStatus = ActionStatus.PROPOSED) : ProposedAction
    data class RescheduleTask(val taskId: Long, val newDate: LocalDate, override val status: ActionStatus = ActionStatus.PROPOSED) : ProposedAction
}

data class ChatMessage(
    val id: Long = 0,
    val role: ChatRole,
    val text: String,
    val createdAt: Instant,
    val actions: List<ProposedAction> = emptyList(),
)

/** User-controlled data sharing for the AI coach. Defaults are private. */
data class AiPrivacySettings(
    val remoteProviderEnabled: Boolean = false,
    val shareTaskTitles: Boolean = true,
    /** App list / usage data is NEVER sent unless this is explicitly enabled. */
    val shareAppUsage: Boolean = false,
    val dailyMessageLimit: Int = 50,
)
