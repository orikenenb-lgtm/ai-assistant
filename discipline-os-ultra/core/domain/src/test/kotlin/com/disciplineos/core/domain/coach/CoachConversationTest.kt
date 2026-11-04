package com.disciplineos.core.domain.coach

import com.disciplineos.core.domain.gamification.B2
import com.disciplineos.core.domain.gamification.B2.TODAY
import com.disciplineos.core.domain.gamification.FakeChatRepository
import com.disciplineos.core.domain.gamification.FakeFocusRepository
import com.disciplineos.core.domain.gamification.FakeSettingsRepository
import com.disciplineos.core.domain.gamification.FakeTaskRepository
import com.disciplineos.core.domain.task.TaskError
import com.disciplineos.core.domain.task.TaskInput
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.model.*
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalTime

private class ScriptedCoach(private val chunks: List<CoachChunk>, private val throwAfter: Boolean = false) : AiCoachRepository {
    var calls = 0
    var lastMessage: String? = null
    var lastHistory: List<ChatMessage> = emptyList()
    override val providerName = "scripted"
    override fun streamReply(history: List<ChatMessage>, userMessage: String, context: CoachContext): Flow<CoachChunk> = flow {
        calls++
        lastMessage = userMessage
        lastHistory = history
        chunks.forEach { emit(it) }
        if (throwAfter) throw IllegalStateException("boom")
    }
}

class CoachConversationUseCaseTest {
    private val chat = FakeChatRepository()
    private val settings = FakeSettingsRepository(AiPrivacySettings(dailyMessageLimit = 3))
    private val tasks = FakeTaskRepository()
    private val time = B2.timeAt()
    private val created = mutableListOf<TaskInput>()
    private val updated = mutableListOf<Pair<Long, TaskInput>>()
    private var createResult: TaskResult<Long> = TaskResult.Success(100L)
    private val emptyContext = CoachContext(TODAY.toString(), emptyList(), emptyList(), 0, 0, 0)

    private fun useCase(coach: AiCoachRepository) = CoachConversationUseCase(
        chatRepo = chat,
        coach = coach,
        buildContext = { emptyContext },
        settings = settings,
        createTask = { input -> yield(); created += input; createResult },
        updateTask = { id, input -> updated += id to input; TaskResult.Success(Unit) },
        taskRepo = tasks,
        time = time,
    )

    private val createJson = """{"type":"create_task","title":"הליכה","kind":"OPTIONAL","priority":"LOW","date":"$TODAY","time":"18:00","estimatedMinutes":20,"subTasks":["נעליים"]}"""

    @Test fun limitReached_neverCallsProvider_andPersistsNothing() = runTest {
        repeat(3) { chat.insertMessage(ChatMessage(role = ChatRole.USER, text = "m$it", createdAt = B2.at(TODAY, 8))) }
        val coach = ScriptedCoach(listOf(CoachChunk.TextDelta("hi"), CoachChunk.Done))
        val states = useCase(coach).send("שלום").toList()
        assertEquals(listOf(CoachSendState.LimitReached), states)
        assertEquals(0, coach.calls)
        assertEquals(3, chat.messages.value.size)
    }

    @Test fun messagesFromYesterday_doNotCountTowardsLimit() = runTest {
        repeat(5) { chat.insertMessage(ChatMessage(role = ChatRole.USER, text = "m$it", createdAt = B2.at(TODAY.minusDays(1), 23))) }
        val coach = ScriptedCoach(listOf(CoachChunk.Done))
        assertEquals(CoachSendState.Completed, useCase(coach).send("שלום").toList().last())
        assertEquals(1, coach.calls)
    }

    @Test fun zeroLimit_blocks() = runTest {
        settings.privacy.value = AiPrivacySettings(dailyMessageLimit = 0)
        val coach = ScriptedCoach(listOf(CoachChunk.Done))
        assertEquals(listOf(CoachSendState.LimitReached), useCase(coach).send("x").toList())
        assertEquals(0, coach.calls)
    }

    @Test fun happyPath_streamsAndPersistsSanitizedUserAndAssistantWithActions() = runTest {
        val coach = ScriptedCoach(listOf(CoachChunk.TextDelta("הנה "), CoachChunk.TextDelta("הצעה"), CoachChunk.ActionJson(createJson), CoachChunk.Done))
        val states = useCase(coach).send("  תכנן‮ לי  ").toList()
        assertEquals(
            listOf(CoachSendState.Sending, CoachSendState.Streaming("הנה "), CoachSendState.Streaming("הנה הצעה"), CoachSendState.Completed),
            states,
        )
        assertEquals("תכנן לי", coach.lastMessage)
        val (user, assistant) = chat.messages.value
        assertEquals(ChatRole.USER, user.role); assertEquals("תכנן לי", user.text)
        assertEquals(ChatRole.ASSISTANT, assistant.role); assertEquals("הנה הצעה", assistant.text)
        val action = assistant.actions.single() as ProposedAction.CreateTask
        assertEquals(LocalTime.of(18, 0), action.draft.time)
        assertEquals(ActionStatus.PROPOSED, action.status)
    }

    @Test fun invalidActions_droppedAndCounted_neverActionable() = runTest {
        tasks.setOccurrences(listOf(B2.occ(1, B2.task(5), TODAY)))
        val coach = ScriptedCoach(
            listOf(
                CoachChunk.TextDelta("ok"),
                CoachChunk.ActionJson("""{"type":"delete_all"}"""),
                CoachChunk.ActionJson("""{"type":"reschedule_task","taskId":999,"newDate":"$TODAY"}"""),
                CoachChunk.ActionJson("""{"type":"reschedule_task","taskId":5,"newDate":"${TODAY.plusDays(1)}"}"""),
                CoachChunk.ActionJson("not json"),
                CoachChunk.Done,
            ),
        )
        useCase(coach).send("hi").toList()
        val assistant = chat.messages.value.first { it.role == ChatRole.ASSISTANT }
        assertEquals(listOf(ProposedAction.RescheduleTask(5, TODAY.plusDays(1))), assistant.actions)
        val notice = chat.messages.value.last()
        assertEquals(ChatRole.NOTICE, notice.role)
        assertTrue(notice.text.contains("3"))
    }

    @Test fun actionsCappedAtFive() = runTest {
        val coach = ScriptedCoach(List(8) { CoachChunk.ActionJson(createJson) } + CoachChunk.Done)
        useCase(coach).send("hi").toList()
        assertEquals(CoachConversationUseCase.MAX_ACTIONS, chat.messages.value.first { it.role == ChatRole.ASSISTANT }.actions.size)
    }

    @Test fun error_persistsHebrewNotice_andFails() = runTest {
        val coach = ScriptedCoach(listOf(CoachChunk.TextDelta("partial"), CoachChunk.Error(CoachErrorKind.RATE_LIMITED, "429"), CoachChunk.TextDelta("ignored")))
        val states = useCase(coach).send("hi").toList()
        assertEquals(CoachSendState.Failed(CoachErrorKind.RATE_LIMITED), states.last())
        assertFalse(states.any { it is CoachSendState.Streaming && it.partialText.contains("ignored") })
        val roles = chat.messages.value.map { it.role }
        assertEquals(listOf(ChatRole.USER, ChatRole.NOTICE), roles)
        assertTrue(Regex("[\\u0590-\\u05FF]").containsMatchIn(chat.messages.value.last().text))
    }

    @Test fun providerException_becomesBackendUnavailable() = runTest {
        val coach = ScriptedCoach(listOf(CoachChunk.TextDelta("x")), throwAfter = true)
        assertEquals(CoachSendState.Failed(CoachErrorKind.BACKEND_UNAVAILABLE), useCase(coach).send("hi").toList().last())
        assertEquals(ChatRole.NOTICE, chat.messages.value.last().role)
    }

    @Test fun streamEndingWithoutDone_isStillPersisted() = runTest {
        useCase(ScriptedCoach(listOf(CoachChunk.TextDelta("שלום")))).send("hi").toList()
        assertEquals("שלום", chat.messages.value.last().text)
    }

    @Test fun historyExcludesNotices_andBlankInputSendsNothing() = runTest {
        chat.insertMessage(ChatMessage(role = ChatRole.NOTICE, text = "n", createdAt = B2.at(TODAY, 8)))
        chat.insertMessage(ChatMessage(role = ChatRole.ASSISTANT, text = "a", createdAt = B2.at(TODAY, 8)))
        val coach = ScriptedCoach(listOf(CoachChunk.Done))
        val uc = useCase(coach)
        uc.send("q").toList()
        assertEquals(listOf(ChatRole.ASSISTANT), coach.lastHistory.map { it.role })
        assertEquals(emptyList<CoachSendState>(), uc.send(" ‮\n ").toList())
        assertEquals(1, coach.calls)
    }

    private suspend fun seedAssistantWith(vararg actions: ProposedAction): Long =
        chat.insertMessage(ChatMessage(role = ChatRole.ASSISTANT, text = "s", createdAt = B2.at(TODAY, 9), actions = actions.toList()))

    @Test fun acceptCreate_createsTaskOnce_evenWithConcurrentTaps() = runTest {
        val draft = TaskDraft("הליכה", TaskKind.MANDATORY, Priority.HIGH, null, LocalTime.of(7, 0), 20, listOf("א"))
        val id = seedAssistantWith(ProposedAction.CreateTask(draft))
        val uc = useCase(ScriptedCoach(emptyList()))
        val results = listOf(async { uc.acceptAction(id, 0) }, async { uc.acceptAction(id, 0) }).awaitAll()
        assertEquals(1, created.size)
        assertEquals(1, results.count { it is TaskResult.Success })
        assertEquals(TaskResult.Failure(TaskError.ALREADY_RESOLVED), results.first { it is TaskResult.Failure })
        val input = created.single()
        assertEquals(TaskInput(title = "הליכה", kind = TaskKind.MANDATORY, priority = Priority.HIGH, startDate = TODAY, dueTime = LocalTime.of(7, 0), estimatedMinutes = 20, subTasks = listOf("א")), input)
        assertEquals(ActionStatus.ACCEPTED, chat.messages.value.single().actions.single().status)
    }

    @Test fun acceptCreate_usesDraftDate_andStaleDateFallsBackToToday() = runTest {
        val id = seedAssistantWith(
            ProposedAction.CreateTask(TaskDraft("a", date = TODAY.plusDays(3))),
            ProposedAction.CreateTask(TaskDraft("b", date = TODAY.minusDays(2))),
        )
        val uc = useCase(ScriptedCoach(emptyList()))
        uc.acceptAction(id, 0); uc.acceptAction(id, 1)
        assertEquals(listOf(TODAY.plusDays(3), TODAY), created.map { it.startDate })
    }

    @Test fun acceptCreate_failureMarksInvalid() = runTest {
        createResult = TaskResult.Failure(TaskError.TITLE_TOO_LONG)
        val id = seedAssistantWith(ProposedAction.CreateTask(TaskDraft("a")))
        assertEquals(TaskResult.Failure(TaskError.TITLE_TOO_LONG), useCase(ScriptedCoach(emptyList())).acceptAction(id, 0))
        assertEquals(ActionStatus.INVALID, chat.messages.value.single().actions.single().status)
    }

    @Test fun acceptReschedule_updatesStartDatePreservingTaskFields() = runTest {
        val task = B2.task(5, TaskKind.MANDATORY, Priority.CRITICAL, title = "דוח", categoryId = 3).copy(
            endDate = TODAY.plusDays(10), dueTime = LocalTime.of(10, 0), notes = "n", reminderOffsetsMinutes = listOf(15),
        )
        tasks.tasks.value = mapOf(5L to task)
        tasks.subTasks.value = mapOf(5L to listOf(SubTask(2, 5, "שני", position = 1), SubTask(1, 5, "ראשון", position = 0)))
        val id = seedAssistantWith(ProposedAction.RescheduleTask(5, TODAY.plusDays(2)))
        assertEquals(TaskResult.Success(Unit), useCase(ScriptedCoach(emptyList())).acceptAction(id, 0))
        val (taskId, input) = updated.single()
        assertEquals(5L, taskId)
        assertEquals(TODAY.plusDays(2), input.startDate)
        assertEquals(TODAY.plusDays(12), input.endDate)
        assertEquals(listOf("ראשון", "שני"), input.subTasks)
        assertEquals(Priority.CRITICAL, input.priority); assertEquals(3L, input.categoryId); assertEquals(listOf(15), input.reminderOffsetsMinutes)
        assertEquals(ActionStatus.ACCEPTED, chat.messages.value.single().actions.single().status)
    }

    @Test fun acceptReschedule_missingTaskMarksInvalid() = runTest {
        val id = seedAssistantWith(ProposedAction.RescheduleTask(42, TODAY.plusDays(1)))
        assertEquals(TaskResult.Failure(TaskError.NOT_FOUND), useCase(ScriptedCoach(emptyList())).acceptAction(id, 0))
        assertEquals(ActionStatus.INVALID, chat.messages.value.single().actions.single().status)
        assertTrue(updated.isEmpty())
    }

    @Test fun reject_marksRejected_andCannotBeAcceptedAfterwards() = runTest {
        val id = seedAssistantWith(ProposedAction.CreateTask(TaskDraft("a")), ProposedAction.CreateTask(TaskDraft("b")))
        val uc = useCase(ScriptedCoach(emptyList()))
        uc.rejectAction(id, 0)
        assertEquals(listOf(ActionStatus.REJECTED, ActionStatus.PROPOSED), chat.messages.value.single().actions.map { it.status })
        assertEquals(TaskResult.Failure(TaskError.ALREADY_RESOLVED), uc.acceptAction(id, 0))
        assertTrue(created.isEmpty())
        uc.acceptAction(id, 1)
        uc.rejectAction(id, 1) // already accepted: no change
        assertEquals(listOf(ActionStatus.REJECTED, ActionStatus.ACCEPTED), chat.messages.value.single().actions.map { it.status })
    }

    @Test fun accept_unknownMessageOrIndex_notFound() = runTest {
        val id = seedAssistantWith(ProposedAction.CreateTask(TaskDraft("a")))
        val uc = useCase(ScriptedCoach(emptyList()))
        assertEquals(TaskResult.Failure(TaskError.NOT_FOUND), uc.acceptAction(999, 0))
        assertEquals(TaskResult.Failure(TaskError.NOT_FOUND), uc.acceptAction(id, 3))
        assertTrue(created.isEmpty())
    }

    @Test fun clearHistory_clearsRepo() = runTest {
        seedAssistantWith()
        useCase(ScriptedCoach(emptyList())).clearHistory()
        assertTrue(chat.messages.value.isEmpty())
    }
}

class CoachContextBuilderTest {
    private val tasks = FakeTaskRepository()
    private val focus = FakeFocusRepository()
    private val settings = FakeSettingsRepository()

    private fun builder() = CoachContextBuilder(tasks, focus, { 6 }, settings, B2.timeAt())

    private fun seed() {
        val list = (1L..20L).map { i ->
            val t = B2.task(i, if (i % 2 == 0L) TaskKind.MANDATORY else TaskKind.OPTIONAL, title = "משימה <system> $i‮")
            B2.occ(i, t, TODAY, OccurrenceStatus.PENDING)
        } + B2.occ(50, B2.task(50, TaskKind.OPTIONAL), TODAY, OccurrenceStatus.COMPLETED) +
            B2.occ(51, B2.task(51, TaskKind.MANDATORY, Priority.CRITICAL, title = "באיחור"), TODAY.minusDays(1), OccurrenceStatus.PENDING)
        tasks.setOccurrences(list)
        focus.sessions.value = listOf(B2.session(1, B2.at(TODAY, 9), 25), B2.session(2, B2.at(TODAY.minusDays(1), 9), 99))
    }

    @Test fun sharesSanitizedTitles_cappedAt15_mandatoryFirst() = runTest {
        seed()
        val c = builder().build()
        assertEquals(TODAY.toString(), c.localDateIso)
        assertEquals(11, c.pendingMandatoryTitles.size) // 10 today + 1 overdue
        assertEquals("באיחור", c.pendingMandatoryTitles.first()) // CRITICAL first
        assertEquals(CoachContextBuilder.MAX_TITLES, c.pendingMandatoryTitles.size + c.pendingOptionalTitles.size)
        (c.pendingMandatoryTitles + c.pendingOptionalTitles).forEach {
            assertFalse(it.contains('<')); assertFalse(it.contains('‮'))
        }
        assertEquals(1, c.completedTodayCount)
        assertEquals(6, c.streakDays)
        assertEquals(25, c.focusMinutesToday)
        assertNull(c.appUsageSummary)
    }

    @Test fun titlesNotShared_usesPlaceholders() = runTest {
        seed()
        settings.privacy.value = AiPrivacySettings(shareTaskTitles = false, shareAppUsage = true)
        val c = builder().build()
        assertEquals("משימת חובה 1", c.pendingMandatoryTitles.first())
        assertEquals("משימת רשות 1", c.pendingOptionalTitles.first())
        assertTrue((c.pendingMandatoryTitles + c.pendingOptionalTitles).none { it.contains("באיחור") || it.contains("system") })
        assertNull(c.appUsageSummary) // never added by the domain layer, even with shareAppUsage
    }

    @Test fun emptyData() = runTest {
        val c = builder().build()
        assertTrue(c.pendingMandatoryTitles.isEmpty() && c.pendingOptionalTitles.isEmpty())
        assertEquals(0, c.focusMinutesToday)
    }
}

class LocalDemoCoachProviderTest {
    private val provider = LocalDemoCoachProvider(B2.timeAt(), wordDelayMillis = 0)
    private val ctx = CoachContext(TODAY.toString(), listOf("דוח שבועי", "אימון"), listOf("קריאה"), 2, 4, 30)
    private val hebrew = Regex("[\\u0590-\\u05FF]")

    private suspend fun run(msg: String, c: CoachContext = ctx): Pair<String, List<String>> {
        val chunks = provider.streamReply(emptyList(), msg, c).toList()
        assertEquals(CoachChunk.Done, chunks.last())
        val text = chunks.filterIsInstance<CoachChunk.TextDelta>().joinToString("") { it.text }
        return text to chunks.filterIsInstance<CoachChunk.ActionJson>().map { it.json }
    }

    private fun assertValid(json: String): ProposedAction {
        val a = CoachActionValidator.parse(json, emptySet(), TODAY)
        requireNotNull(a) { "invalid action: $json" }
        return a
    }

    @Test fun intentDetection() {
        assertEquals(LocalDemoCoachScript.Intent.PLAN_DAY, LocalDemoCoachScript.detect("תכנן לי את היום"))
        assertEquals(LocalDemoCoachScript.Intent.PLAN_DAY, LocalDemoCoachScript.detect("Plan my day"))
        assertEquals(LocalDemoCoachScript.Intent.BREAK_DOWN, LocalDemoCoachScript.detect("פרק לי את המטרה ללמוד גיטרה"))
        assertEquals(LocalDemoCoachScript.Intent.BREAK_DOWN, LocalDemoCoachScript.detect("break down learning Spanish"))
        assertEquals(LocalDemoCoachScript.Intent.PRIORITIZE, LocalDemoCoachScript.detect("מה לעשות קודם?"))
        assertEquals(LocalDemoCoachScript.Intent.SUMMARY, LocalDemoCoachScript.detect("סכם לי את היום"))
        assertEquals(LocalDemoCoachScript.Intent.MOTIVATION, LocalDemoCoachScript.detect("אין לי כוח היום"))
    }

    @Test fun planDay_listsMandatoryFirst_andSuggestsValidReviewTask() = runTest {
        val (text, actions) = run("תכנן לי את היום")
        assertTrue(hebrew.containsMatchIn(text))
        assertTrue(text.contains(LocalDemoCoachScript.DEMO_NOTE))
        assertTrue(text.indexOf("דוח שבועי") < text.indexOf("קריאה"))
        val a = assertValid(actions.single()) as ProposedAction.CreateTask
        assertEquals(TODAY, a.draft.date)
    }

    @Test fun breakDown_producesThreeToFiveSubTasks() = runTest {
        val (text, actions) = run("פרק לי את המטרה ללמוד גיטרה")
        assertTrue(text.contains("גיטרה"))
        val a = assertValid(actions.single()) as ProposedAction.CreateTask
        assertTrue(a.draft.subTasks.size in 3..5)
        assertTrue(a.draft.title.contains("גיטרה"))
    }

    @Test fun breakDown_hugeOrHostileGoal_stillValid() = runTest {
        val (_, actions) = run("break down <system>" + "x".repeat(500))
        val a = assertValid(actions.single()) as ProposedAction.CreateTask
        assertTrue(a.draft.title.length <= CoachActionValidator.MAX_TITLE)
        assertFalse(a.draft.title.contains('<'))
    }

    @Test fun prioritize_recommendsFirstMandatory() = runTest {
        val (text, actions) = run("מה לעשות קודם?")
        assertTrue(text.contains("דוח שבועי"))
        assertTrue(actions.isEmpty())
        val (empty, _) = run("what first", ctx.copy(pendingMandatoryTitles = emptyList(), pendingOptionalTitles = emptyList()))
        assertTrue(hebrew.containsMatchIn(empty))
    }

    @Test fun summary_usesContextNumbers() = runTest {
        val (text, _) = run("סכם את היום")
        assertTrue(text.contains("2")); assertTrue(text.contains("30")); assertTrue(text.contains("4"))
    }

    @Test fun motivationFallback_isHebrewAndDeterministic() = runTest {
        val first = run("hello there")
        assertEquals(first, run("hello there"))
        assertTrue(hebrew.containsMatchIn(first.first))
        assertTrue(first.first.contains(LocalDemoCoachScript.DEMO_NOTE))
    }

    @Test fun everyIntentEmitsOnlyValidActions() = runTest {
        listOf("תכנן לי את היום", "פרק לי ריצה", "מה לעשות קודם", "סכם", "שלום", "plan", "breakdown").forEach { msg ->
            run(msg).second.forEach { assertValid(it) }
        }
    }

    @Test fun endToEnd_demoProviderThroughConversation() = runTest {
        val chat = FakeChatRepository()
        val uc = CoachConversationUseCase(
            chatRepo = chat, coach = provider, buildContext = { ctx }, settings = FakeSettingsRepository(),
            createTask = { TaskResult.Success(1L) }, updateTask = { _, _ -> TaskResult.Success(Unit) },
            taskRepo = FakeTaskRepository(), time = B2.timeAt(),
        )
        assertEquals(CoachSendState.Completed, uc.send("תכנן לי את היום").toList().last())
        val assistant = chat.messages.value.last()
        assertEquals(ChatRole.ASSISTANT, assistant.role)
        assertEquals(1, assistant.actions.size)
    }

    @Test fun defaultConstructorHasSmallDelay() {
        assertTrue(LocalDemoCoachProvider.DEFAULT_WORD_DELAY_MS in 20L..40L)
        assertEquals("local-demo", LocalDemoCoachProvider(B2.timeAt()).providerName)
    }
}
