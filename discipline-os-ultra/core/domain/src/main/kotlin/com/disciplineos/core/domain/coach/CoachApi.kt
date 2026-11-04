package com.disciplineos.core.domain.coach

import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.domain.repository.ChatRepository
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.task.TaskCommands
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
import java.time.LocalDate
import javax.inject.Inject

data class SanitizedText(val text: String, val flaggedInjection: Boolean, val truncated: Boolean)

/** Defence-in-depth against prompt injection. Never the only control: actions are also validated + user-approved. */
object PromptInjectionGuard {
    const val MAX_USER_CHARS = 2_000
    fun sanitizeUserText(raw: String): SanitizedText = TODO()
    /** For untrusted data placed into the model context (task titles): strip control chars, cap length, neutralise role markers. */
    fun sanitizeContextField(raw: String, maxChars: Int = 120): String = TODO()
}

/** Strict allow-list parser for model-proposed actions. Anything unexpected → null (dropped). */
object CoachActionValidator {
    fun parse(json: String, knownTaskIds: Set<Long>, today: LocalDate): ProposedAction? = TODO()
}

/** Client-side spend guard (the backend enforces its own quota too). */
object CostGuard {
    fun allow(userMessagesToday: Int, dailyLimit: Int): Boolean = TODO()
}

class CoachContextBuilder @Inject constructor(
    private val taskRepo: TaskRepository,
    private val focusRepo: FocusRepository,
    private val gamification: GamificationService,
    private val settings: SettingsRepository,
    private val time: TimeProvider,
) {
    suspend fun build(): CoachContext = TODO()
}

sealed interface CoachSendState {
    data object Sending : CoachSendState
    data class Streaming(val partialText: String) : CoachSendState
    data object Completed : CoachSendState
    data class Failed(val kind: CoachErrorKind) : CoachSendState
    data object LimitReached : CoachSendState
}

class CoachConversationUseCase @Inject constructor(
    private val chatRepo: ChatRepository,
    private val coach: AiCoachRepository,
    private val contextBuilder: CoachContextBuilder,
    private val settings: SettingsRepository,
    private val taskCommands: TaskCommands,
    private val taskRepo: TaskRepository,
    private val time: TimeProvider,
) {
    fun observeMessages(): Flow<List<ChatMessage>> = TODO()
    /** Persists the user message, streams the reply, persists the assistant message with validated actions. */
    fun send(text: String): Flow<CoachSendState> = TODO()
    /** The ONLY path by which coach suggestions become data — requires an explicit user tap. */
    suspend fun acceptAction(messageId: Long, actionIndex: Int): TaskResult<Unit> = TODO()
    suspend fun rejectAction(messageId: Long, actionIndex: Int): Unit = TODO()
    suspend fun clearHistory(): Unit = TODO()
}

/** Offline, deterministic, Hebrew rule-based coach. Works with zero network and zero keys. */
class LocalDemoCoachProvider @Inject constructor(
    private val time: TimeProvider,
) : AiCoachRepository {
    override val providerName: String = "local-demo"
    override fun streamReply(history: List<ChatMessage>, userMessage: String, context: CoachContext): Flow<CoachChunk> = TODO()
}
