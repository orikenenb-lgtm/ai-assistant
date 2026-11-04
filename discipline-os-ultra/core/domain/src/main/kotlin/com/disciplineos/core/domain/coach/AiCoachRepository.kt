package com.disciplineos.core.domain.coach

import com.disciplineos.core.model.ChatMessage
import kotlinx.coroutines.flow.Flow

/** Minimised, user-consented context. Built by CoachContextBuilder; nothing else is ever sent. */
data class CoachContext(
    val localDateIso: String,
    val pendingMandatoryTitles: List<String>,
    val pendingOptionalTitles: List<String>,
    val completedTodayCount: Int,
    val streakDays: Int,
    val focusMinutesToday: Int,
    /** Null unless AiPrivacySettings.shareAppUsage is true. */
    val appUsageSummary: String? = null,
    /**
     * Pending tasks the coach may propose to reschedule (`reschedule_task.taskId` must be one of these ids).
     * Titles follow the same rules as [pendingMandatoryTitles] (sanitised, placeholders unless shareTaskTitles).
     */
    val pendingTasks: List<CoachTaskRef> = emptyList(),
)

/**
 * Minimal reference to a pending task. [id] is the local task id (a meaningless local integer, safe to share);
 * [date] is the ISO local date of the pending occurrence (may be before today = overdue).
 */
data class CoachTaskRef(val id: Long, val title: String, val mandatory: Boolean, val date: String)

sealed interface CoachChunk {
    data class TextDelta(val text: String) : CoachChunk
    /** Raw structured action JSON emitted by a provider. Must pass CoachActionValidator before display. */
    data class ActionJson(val json: String) : CoachChunk
    data class Error(val kind: CoachErrorKind, val message: String) : CoachChunk
    data object Done : CoachChunk
}

enum class CoachErrorKind { OFFLINE, RATE_LIMITED, QUOTA_EXCEEDED, BACKEND_UNAVAILABLE, INVALID_RESPONSE, NOT_CONFIGURED }

/** Provider abstraction: LocalDemoCoachProvider (offline, rule-based) and RemoteBackendCoachProvider (proxy, no keys in APK). */
interface AiCoachRepository {
    val providerName: String
    fun streamReply(history: List<ChatMessage>, userMessage: String, context: CoachContext): Flow<CoachChunk>
}
