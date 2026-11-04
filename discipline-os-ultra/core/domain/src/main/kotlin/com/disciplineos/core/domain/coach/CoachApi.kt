package com.disciplineos.core.domain.coach

import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.domain.repository.ChatRepository
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.task.TaskCommands
import com.disciplineos.core.domain.task.TaskError
import com.disciplineos.core.domain.task.TaskInput
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.transformWhile
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.text.Normalizer
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeParseException
import javax.inject.Inject

data class SanitizedText(val text: String, val flaggedInjection: Boolean, val truncated: Boolean)

/** Defence-in-depth against prompt injection. Never the only control: actions are also validated + user-approved. */
object PromptInjectionGuard {
    const val MAX_USER_CHARS = 2_000

    private val injectionPatterns: List<Regex> = listOf(
        // English
        """\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|directions|messages|context)\b""",
        """\bsystem\s*prompt\b""",
        """\byou\s+are\s+now\b""",
        """\b(developer|god|dan|jailbreak)\s+mode\b""",
        """\bjailbreak\b""",
        """\bpretend\s+(you\s+are|to\s+be)\b""",
        """\bnew\s+instructions?\s*:""",
        """\breveal\b[^.\n]{0,30}\b(prompt|instructions?|secrets?|keys?)\b""",
        // Role tags / chat-template markers
        """<\s*/?\s*(system|assistant|user|developer|tool)\s*>""",
        """(^|\n)\s*#{1,6}\s*(system|assistant|developer|instructions?)\b""",
        """(^|\n)\s*(system|assistant|developer)\s*:""",
        """\[/?\s*(inst|system)\s*]""",
        """<\|\s*(im_start|im_end|system|endoftext)\s*\|>""",
        // Hebrew
        """התעל[םמ]\S*\s+מ(?:כל\s+)?ה{0,2}(?:הוראות|הנחיות|כללים)""",
        """(?:שכח|תשכח|שכחי)\S*\s+(?:את\s+)?(?:כל\s+)?ה{0,2}(?:הוראות|הנחיות)""",
        """(?:הנחי(?:ות|ית)|הוראות|פרומפט|הודעת)\s+(?:ה)?מערכת""",
        // Note: \b is ASCII-only on modern JDKs, so Hebrew patterns use explicit lookaheads instead.
        """אתה\s+עכשיו(?=$|[\s.,!?:])""",
        """מעכשיו\s+(?:אתה|את)(?=$|[\s.,!?:])""",
        """(?:^|\n)\s*(?:מערכת|עוזר)\s*:""",
    ).map { Regex(it, setOf(RegexOption.IGNORE_CASE)) }

    /** Bidi overrides/isolates, zero-width characters and BOM — commonly used to hide instructions. */
    private fun isInvisibleControl(c: Char): Boolean =
        c in '\u202A'..'\u202E' || c in '\u2066'..'\u2069' || c in '\u200B'..'\u200D' || c == '\u2060' || c == '\uFEFF'

    /** Removes C0/C1 control characters (except \n and \t), bidi overrides and zero-width characters. */
    internal fun stripUnsafeChars(raw: String): String = buildString(raw.length) {
        for (c in raw.replace("\r\n", "\n")) {
            when {
                c == '\n' || c == '\t' -> append(c)
                c == '\r' -> append('\n')
                Character.isISOControl(c) -> Unit
                isInvisibleControl(c) -> Unit
                else -> append(c)
            }
        }
    }

    private fun normalizeWhitespace(s: String): String = s
        .replace(Regex("""[\t   -   　]"""), " ")
        .replace(Regex("""[  ]"""), "\n")
        .replace(Regex(""" {2,}"""), " ")
        .replace(Regex(""" *\n *"""), "\n")
        .replace(Regex("""\n{3,}"""), "\n\n")
        .trim()

    private fun truncate(s: String, max: Int): String {
        if (s.length <= max) return s
        var end = max.coerceAtLeast(0)
        if (end > 0 && Character.isHighSurrogate(s[end - 1])) end--
        return s.substring(0, end)
    }

    internal fun looksLikeInjection(text: String): Boolean {
        val probe = Normalizer.normalize(text, Normalizer.Form.NFKC)
        return injectionPatterns.any { it.containsMatchIn(probe) }
    }

    fun sanitizeUserText(raw: String): SanitizedText {
        val cleaned = normalizeWhitespace(stripUnsafeChars(raw))
        // Detect on the full text so a payload hidden after the truncation point is still recorded.
        val flagged = looksLikeInjection(cleaned)
        val truncated = cleaned.length > MAX_USER_CHARS
        val text = if (truncated) truncate(cleaned, MAX_USER_CHARS).trimEnd() else cleaned
        return SanitizedText(text, flagged, truncated)
    }

    /** For untrusted data placed into the model context (task titles): strip control chars, cap length, neutralise role markers. */
    fun sanitizeContextField(raw: String, maxChars: Int = 120): String {
        var s = stripUnsafeChars(raw)
            .replace(Regex("""\s+"""), " ")
            .replace(Regex("""[<>\[\]{}`|]"""), "")
            .replace(Regex("""#{2,}"""), "#")
        // "system:" / "assistant:" / "מערכת:" → "system -" so it can't read as a role header.
        s = s.replace(Regex("""\b(system|assistant|user|developer|tool)\s*:""", RegexOption.IGNORE_CASE), "$1 -")
        s = s.replace(Regex("""(מערכת|עוזר|משתמש)\s*:"""), "$1 -")
        return truncate(s.trim(), maxChars.coerceAtLeast(0)).trim()
    }
}

/** Strict allow-list parser for model-proposed actions. Anything unexpected → null (dropped). */
object CoachActionValidator {
    const val MAX_TITLE = 120
    const val MAX_SUBTASKS = 10
    const val MAX_JSON_CHARS = 8_000
    const val MAX_DAYS_AHEAD = 365L
    val ESTIMATE_RANGE = 1..720

    private val CREATE_KEYS = setOf("type", "title", "kind", "priority", "date", "time", "estimatedMinutes", "subTasks")
    private val CREATE_REQUIRED = setOf("type", "title", "kind", "priority")
    private val RESCHEDULE_KEYS = setOf("type", "taskId", "newDate")
    private val DATE_RE = Regex("""\d{4}-\d{2}-\d{2}""")
    private val TIME_RE = Regex("""\d{2}:\d{2}""")

    fun parse(json: String, knownTaskIds: Set<Long>, today: LocalDate): ProposedAction? = try {
        if (json.length > MAX_JSON_CHARS) null else parseObject(Json.parseToJsonElement(json), knownTaskIds, today)
    } catch (e: Exception) {
        null
    } catch (e: StackOverflowError) {
        null
    }

    private fun parseObject(element: JsonElement, knownTaskIds: Set<Long>, today: LocalDate): ProposedAction? {
        val obj = element as? JsonObject ?: return null
        return when (obj.string("type")) {
            "create_task" -> parseCreate(obj, today)
            "reschedule_task" -> parseReschedule(obj, knownTaskIds, today)
            else -> null
        }
    }

    private fun parseCreate(obj: JsonObject, today: LocalDate): ProposedAction? {
        if (!CREATE_KEYS.containsAll(obj.keys) || !obj.keys.containsAll(CREATE_REQUIRED)) return null
        val rawTitle = obj.string("title") ?: return null
        if (rawTitle.length > MAX_TITLE) return null
        val title = PromptInjectionGuard.sanitizeContextField(rawTitle, MAX_TITLE)
        if (title.isBlank()) return null
        val kind = TaskKind.entries.firstOrNull { it.name == obj.string("kind") } ?: return null
        val priority = Priority.entries.firstOrNull { it.name == obj.string("priority") } ?: return null

        val date = when (val e = obj["date"]) {
            null, JsonNull -> null
            else -> parseDate(e, today) ?: return null
        }
        val time = when (val e = obj["time"]) {
            null, JsonNull -> null
            else -> parseTime(e) ?: return null
        }
        val estimate = when (val e = obj["estimatedMinutes"]) {
            null, JsonNull -> null
            else -> e.integer()?.takeIf { it in ESTIMATE_RANGE.first.toLong()..ESTIMATE_RANGE.last.toLong() }?.toInt() ?: return null
        }
        val subTasks = when (val e = obj["subTasks"]) {
            null, JsonNull -> emptyList()
            is JsonArray -> {
                if (e.size > MAX_SUBTASKS) return null
                e.map { item ->
                    val raw = (item as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
                    if (raw.length > MAX_TITLE) return null
                    PromptInjectionGuard.sanitizeContextField(raw, MAX_TITLE).takeIf { it.isNotBlank() } ?: return null
                }
            }
            else -> return null
        }
        return ProposedAction.CreateTask(TaskDraft(title, kind, priority, date, time, estimate, subTasks))
    }

    private fun parseReschedule(obj: JsonObject, knownTaskIds: Set<Long>, today: LocalDate): ProposedAction? {
        if (obj.keys != RESCHEDULE_KEYS) return null
        val taskId = obj["taskId"]?.integer() ?: return null
        if (taskId !in knownTaskIds) return null
        val newDate = parseDate(obj.getValue("newDate"), today) ?: return null
        return ProposedAction.RescheduleTask(taskId, newDate)
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** A JSON number literal that is an exact integer (no strings, no decimals, no exponents). */
    private fun JsonElement.integer(): Long? {
        val p = this as? JsonPrimitive ?: return null
        if (p.isString || p is JsonNull) return null
        if (!Regex("""-?\d{1,12}""").matches(p.content)) return null
        return p.longOrNull
    }

    private fun parseDate(e: JsonElement, today: LocalDate): LocalDate? {
        val s = (e as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        if (!DATE_RE.matches(s)) return null
        val d = try { LocalDate.parse(s) } catch (_: DateTimeParseException) { return null }
        if (d.isBefore(today) || d.isAfter(today.plusDays(MAX_DAYS_AHEAD))) return null
        return d
    }

    private fun parseTime(e: JsonElement): LocalTime? {
        val s = (e as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        if (!TIME_RE.matches(s)) return null
        return try { LocalTime.parse(s) } catch (_: DateTimeParseException) { null }
    }
}

/** Client-side spend guard (the backend enforces its own quota too). */
object CostGuard {
    fun allow(userMessagesToday: Int, dailyLimit: Int): Boolean = dailyLimit > 0 && userMessagesToday < dailyLimit
}

/**
 * Builds the minimal context sent to a coach provider. Task titles are included only when
 * [AiPrivacySettings.shareTaskTitles] is on (sanitised, max [MAX_TITLES]); otherwise generic placeholders are used.
 * [CoachContext.pendingTasks] carries the same tasks with their local ids (so `reschedule_task` can be validated against
 * real ids) and the same title rules.
 * [CoachContext.appUsageSummary] is ALWAYS null here: app usage may only be added by the Android layer, and only when
 * [AiPrivacySettings.shareAppUsage] is explicitly enabled.
 */
class CoachContextBuilder internal constructor(
    private val taskRepo: TaskRepository,
    private val focusRepo: FocusRepository,
    private val streakDays: suspend () -> Int,
    private val settings: SettingsRepository,
    private val time: TimeProvider,
) {
    @Inject
    constructor(
        taskRepo: TaskRepository,
        focusRepo: FocusRepository,
        gamification: GamificationService,
        settings: SettingsRepository,
        time: TimeProvider,
    ) : this(taskRepo, focusRepo, { gamification.observeProgress().first().currentStreakDays }, settings, time)

    suspend fun build(): CoachContext {
        val today = time.today()
        val zone = time.zone()
        val privacy = settings.observeAiPrivacy().first()
        val todays = taskRepo.observeOccurrences(today, today).first()
        val open = taskRepo.observeOpenOccurrences(today).first()
            .filter { it.occurrence.status == OccurrenceStatus.PENDING && !it.task.archived }
            .distinctBy { it.occurrence.id }
            .sortedWith(
                compareByDescending<OccurrenceWithTask> { it.task.priority.weight }
                    .thenBy { it.occurrence.localDate }
                    .thenBy { it.occurrence.dueAt },
            )
        val mandatory = open.filter { it.task.kind == TaskKind.MANDATORY }.take(MAX_TITLES)
        val optional = open.filter { it.task.kind == TaskKind.OPTIONAL }.take(MAX_TITLES - mandatory.size)

        fun titles(list: List<OccurrenceWithTask>, placeholder: String): List<String> =
            list.mapIndexed { i, o ->
                if (privacy.shareTaskTitles) {
                    PromptInjectionGuard.sanitizeContextField(o.task.title).ifBlank { "$placeholder ${i + 1}" }
                } else {
                    "$placeholder ${i + 1}"
                }
            }

        val startOfDay = today.atStartOfDay(zone).toInstant()
        val focusSeconds = focusRepo.observeSessions(startOfDay).first()
            .filter { it.startedAt.atZone(zone).toLocalDate() == today }
            .sumOf { it.focusedSeconds.coerceAtLeast(0) }

        val mandatoryTitles = titles(mandatory, "משימת חובה")
        val optionalTitles = titles(optional, "משימת רשות")
        // Same tasks and same (possibly placeholder) titles as above, plus the local ids needed for reschedule_task.
        // A recurring task with several open occurrences appears once (its highest-ranked occurrence).
        val refs = (mandatory.zip(mandatoryTitles) + optional.zip(optionalTitles))
            .map { (o, title) ->
                CoachTaskRef(
                    id = o.task.id,
                    title = title,
                    mandatory = o.task.kind == TaskKind.MANDATORY,
                    date = o.occurrence.localDate.toString(),
                )
            }
            .distinctBy { it.id }

        return CoachContext(
            localDateIso = today.toString(),
            pendingMandatoryTitles = mandatoryTitles,
            pendingOptionalTitles = optionalTitles,
            completedTodayCount = todays.count { it.occurrence.status == OccurrenceStatus.COMPLETED },
            streakDays = streakDays().coerceAtLeast(0),
            focusMinutesToday = (focusSeconds / 60).toInt(),
            appUsageSummary = null,
            pendingTasks = refs,
        )
    }

    companion object {
        const val MAX_TITLES = 15
    }
}

sealed interface CoachSendState {
    data object Sending : CoachSendState
    data class Streaming(val partialText: String) : CoachSendState
    data object Completed : CoachSendState
    data class Failed(val kind: CoachErrorKind) : CoachSendState
    data object LimitReached : CoachSendState
}

class CoachConversationUseCase internal constructor(
    private val chatRepo: ChatRepository,
    private val coach: AiCoachRepository,
    private val buildContext: suspend () -> CoachContext,
    private val settings: SettingsRepository,
    private val createTask: suspend (TaskInput) -> TaskResult<Long>,
    private val updateTask: suspend (Long, TaskInput) -> TaskResult<Unit>,
    private val taskRepo: TaskRepository,
    private val time: TimeProvider,
) {
    @Inject
    constructor(
        chatRepo: ChatRepository,
        coach: AiCoachRepository,
        contextBuilder: CoachContextBuilder,
        settings: SettingsRepository,
        taskCommands: TaskCommands,
        taskRepo: TaskRepository,
        time: TimeProvider,
    ) : this(
        chatRepo = chatRepo,
        coach = coach,
        buildContext = { contextBuilder.build() },
        settings = settings,
        createTask = { input -> taskCommands.createTask(input) },
        updateTask = { id, input -> taskCommands.updateTask(id, input) },
        taskRepo = taskRepo,
        time = time,
    )

    private val actionMutex = Mutex()

    fun observeMessages(): Flow<List<ChatMessage>> = chatRepo.observeMessages()

    /** Persists the user message, streams the reply, persists the assistant message with validated actions. */
    fun send(text: String): Flow<CoachSendState> = flow {
        val privacy = settings.observeAiPrivacy().first()
        val today = time.today()
        val sentToday = chatRepo.countUserMessagesSince(today.atStartOfDay(time.zone()).toInstant())
        if (!CostGuard.allow(sentToday, privacy.dailyMessageLimit)) {
            emit(CoachSendState.LimitReached)
            return@flow
        }
        val sanitized = PromptInjectionGuard.sanitizeUserText(text)
        if (sanitized.text.isBlank()) return@flow
        emit(CoachSendState.Sending)

        val history = chatRepo.observeMessages().first()
            .filter { it.role != ChatRole.NOTICE }
            .takeLast(MAX_HISTORY)
        chatRepo.insertMessage(ChatMessage(role = ChatRole.USER, text = sanitized.text, createdAt = time.now()))

        val context = buildContext()
        // Source of truth is the repository (not the context the provider saw): every id offered in
        // context.pendingTasks is an active task, and an id the model invents still fails validation.
        val knownTaskIds = taskRepo.getAllActiveTasks().map { it.id }.toSet()
        val reply = StringBuilder()
        val actions = ArrayList<ProposedAction>()
        var invalidActions = 0
        var failure: CoachChunk.Error? = null

        coach.streamReply(history, sanitized.text, context)
            // Upstream-only: provider exceptions become a BACKEND_UNAVAILABLE error (keeps exception transparency).
            .catch { e ->
                if (e is CancellationException) throw e
                emit(CoachChunk.Error(CoachErrorKind.BACKEND_UNAVAILABLE, e.javaClass.simpleName))
            }
            .transformWhile { chunk ->
                emit(chunk)
                chunk !is CoachChunk.Done && chunk !is CoachChunk.Error
            }
            .collect { chunk ->
                when (chunk) {
                    is CoachChunk.TextDelta -> {
                        reply.append(chunk.text)
                        emit(CoachSendState.Streaming(reply.toString()))
                    }
                    is CoachChunk.ActionJson -> {
                        val action = CoachActionValidator.parse(chunk.json, knownTaskIds, time.today())
                        if (action != null && actions.size < MAX_ACTIONS) actions += action else invalidActions++
                    }
                    is CoachChunk.Error -> failure = chunk
                    CoachChunk.Done -> Unit
                }
            }

        val error = failure
        if (error != null) {
            chatRepo.insertMessage(ChatMessage(role = ChatRole.NOTICE, text = CoachNotices.forError(error.kind), createdAt = time.now()))
            emit(CoachSendState.Failed(error.kind))
            return@flow
        }

        val assistantText = PromptInjectionGuard.stripUnsafeChars(reply.toString()).trim()
            .ifBlank { if (actions.isEmpty()) CoachNotices.EMPTY_REPLY else CoachNotices.ACTIONS_ONLY }
        chatRepo.insertMessage(ChatMessage(role = ChatRole.ASSISTANT, text = assistantText, createdAt = time.now(), actions = actions))
        if (invalidActions > 0) {
            chatRepo.insertMessage(ChatMessage(role = ChatRole.NOTICE, text = CoachNotices.droppedActions(invalidActions), createdAt = time.now()))
        }
        emit(CoachSendState.Completed)
    }

    /** The ONLY path by which coach suggestions become data — requires an explicit user tap. */
    suspend fun acceptAction(messageId: Long, actionIndex: Int): TaskResult<Unit> = actionMutex.withLock {
        val message = chatRepo.observeMessages().first().firstOrNull { it.id == messageId }
            ?: return@withLock TaskResult.Failure(TaskError.NOT_FOUND)
        val action = message.actions.getOrNull(actionIndex) ?: return@withLock TaskResult.Failure(TaskError.NOT_FOUND)
        if (action.status != ActionStatus.PROPOSED) return@withLock TaskResult.Failure(TaskError.ALREADY_RESOLVED)

        val today = time.today()
        val result: TaskResult<Unit> = when (action) {
            is ProposedAction.CreateTask -> {
                val d = action.draft
                val start = d.date?.takeIf { !it.isBefore(today) } ?: today
                val input = TaskInput(
                    title = d.title,
                    kind = d.kind,
                    priority = d.priority,
                    startDate = start,
                    dueTime = d.time,
                    estimatedMinutes = d.estimatedMinutes,
                    subTasks = d.subTasks,
                )
                when (val r = createTask(input)) {
                    is TaskResult.Success -> TaskResult.Success(Unit)
                    is TaskResult.Failure -> r
                }
            }
            is ProposedAction.RescheduleTask -> reschedule(action, today)
        }
        val newStatus = if (result is TaskResult.Success) ActionStatus.ACCEPTED else ActionStatus.INVALID
        chatRepo.updateMessage(message.withActionStatus(actionIndex, newStatus))
        result
    }

    private suspend fun reschedule(action: ProposedAction.RescheduleTask, today: LocalDate): TaskResult<Unit> {
        if (action.newDate.isBefore(today)) return TaskResult.Failure(TaskError.INVALID_DATE_RANGE)
        val task = taskRepo.getTask(action.taskId) ?: return TaskResult.Failure(TaskError.NOT_FOUND)
        val subTasks = taskRepo.observeSubTasks(task.id).first().sortedBy { it.position }.map { it.title }
        val shift = java.time.temporal.ChronoUnit.DAYS.between(task.startDate, action.newDate)
        val input = TaskInput(
            title = task.title,
            notes = task.notes,
            kind = task.kind,
            priority = task.priority,
            categoryId = task.categoryId,
            startDate = action.newDate,
            dueTime = task.dueTime,
            endDate = task.endDate?.plusDays(shift),
            recurrence = task.recurrence,
            reminderOffsetsMinutes = task.reminderOffsetsMinutes,
            estimatedMinutes = task.estimatedMinutes,
            verification = task.verification,
            dependsOn = task.dependsOn,
            subTasks = subTasks,
        )
        return updateTask(task.id, input)
    }

    suspend fun rejectAction(messageId: Long, actionIndex: Int): Unit = actionMutex.withLock {
        val message = chatRepo.observeMessages().first().firstOrNull { it.id == messageId } ?: return@withLock
        val action = message.actions.getOrNull(actionIndex) ?: return@withLock
        if (action.status != ActionStatus.PROPOSED) return@withLock
        chatRepo.updateMessage(message.withActionStatus(actionIndex, ActionStatus.REJECTED))
    }

    suspend fun clearHistory() {
        chatRepo.clear()
    }

    private fun ChatMessage.withActionStatus(index: Int, status: ActionStatus): ChatMessage =
        copy(
            actions = actions.mapIndexed { i, a ->
                if (i != index) a else when (a) {
                    is ProposedAction.CreateTask -> a.copy(status = status)
                    is ProposedAction.RescheduleTask -> a.copy(status = status)
                }
            },
        )

    companion object {
        const val MAX_ACTIONS = 5
        const val MAX_HISTORY = 20
    }
}

/** Offline, deterministic, Hebrew rule-based coach. Works with zero network and zero keys. */
class LocalDemoCoachProvider internal constructor(
    private val time: TimeProvider,
    private val wordDelayMillis: Long,
) : AiCoachRepository {
    @Inject
    constructor(time: TimeProvider) : this(time, DEFAULT_WORD_DELAY_MS)

    override val providerName: String = "local-demo"

    override fun streamReply(history: List<ChatMessage>, userMessage: String, context: CoachContext): Flow<CoachChunk> = flow {
        val reply = LocalDemoCoachScript.reply(userMessage, context, time.today())
        val words = reply.text.split(' ')
        words.forEachIndexed { i, w ->
            if (wordDelayMillis > 0) delay(wordDelayMillis)
            emit(CoachChunk.TextDelta(if (i < words.lastIndex) "$w " else w))
        }
        reply.actionJson.forEach { emit(CoachChunk.ActionJson(it)) }
        emit(CoachChunk.Done)
    }

    companion object {
        const val DEFAULT_WORD_DELAY_MS = 30L
    }
}
