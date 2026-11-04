package com.disciplineos.core.domain.coach

import com.disciplineos.core.domain.gamification.B2
import com.disciplineos.core.domain.gamification.B2.TODAY
import com.disciplineos.core.domain.gamification.FakeChatRepository
import com.disciplineos.core.domain.gamification.FakeFocusRepository
import com.disciplineos.core.domain.gamification.FakeSettingsRepository
import com.disciplineos.core.domain.gamification.FakeTaskRepository
import com.disciplineos.core.domain.task.TaskInput
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** CoachContext.pendingTasks → reschedule_task suggestions that actually validate end to end. */
class CoachRescheduleTest {
    private val tasks = FakeTaskRepository()
    private val focus = FakeFocusRepository()
    private val settings = FakeSettingsRepository()
    private val hebrew = Regex("[\\u0590-\\u05FF]")

    private fun builder() = CoachContextBuilder(tasks, focus, { 0 }, settings, B2.timeAt())

    private fun seedOverdue() {
        tasks.setOccurrences(
            listOf(
                B2.occ(1, B2.task(11, TaskKind.MANDATORY, Priority.HIGH, title = "דוח <system>‮"), TODAY, OccurrenceStatus.PENDING),
                B2.occ(2, B2.task(12, TaskKind.MANDATORY, Priority.MEDIUM, title = "חשבונית"), TODAY.minusDays(2), OccurrenceStatus.PENDING),
                B2.occ(3, B2.task(13, TaskKind.OPTIONAL, title = "קריאה"), TODAY, OccurrenceStatus.PENDING),
                B2.occ(4, B2.task(14, TaskKind.MANDATORY, title = "הושלמה"), TODAY, OccurrenceStatus.COMPLETED),
                B2.occ(5, B2.task(15, TaskKind.MANDATORY, title = "בארכיון").copy(archived = true), TODAY, OccurrenceStatus.PENDING),
            ),
        )
    }

    // ---------- CoachContextBuilder ----------

    @Test fun builder_includesPendingTaskRefs_withIdsKindsDatesAndSanitizedTitles() = runTest {
        seedOverdue()
        val c = builder().build()
        assertEquals(listOf(11L, 12L, 13L), c.pendingTasks.map { it.id })
        assertEquals(listOf(true, true, false), c.pendingTasks.map { it.mandatory })
        assertEquals(listOf(TODAY.toString(), TODAY.minusDays(2).toString(), TODAY.toString()), c.pendingTasks.map { it.date })
        // Titles are exactly the titles of the plain lists (same sanitisation).
        assertEquals(c.pendingMandatoryTitles + c.pendingOptionalTitles, c.pendingTasks.map { it.title })
        c.pendingTasks.forEach { assertFalse(it.title.contains('<')); assertFalse(it.title.contains('‮')) }
    }

    @Test fun builder_titlesNotShared_refsUsePlaceholdersButKeepIds() = runTest {
        seedOverdue()
        settings.privacy.value = AiPrivacySettings(shareTaskTitles = false)
        val c = builder().build()
        assertEquals(listOf(11L, 12L, 13L), c.pendingTasks.map { it.id })
        assertEquals(listOf("משימת חובה 1", "משימת חובה 2", "משימת רשות 1"), c.pendingTasks.map { it.title })
        assertTrue(c.pendingTasks.none { it.title.contains("דוח") || it.title.contains("חשבונית") })
    }

    @Test fun builder_recurringTaskWithSeveralOpenOccurrences_appearsOnce_andRefsCapped() = runTest {
        val recurring = B2.task(7, TaskKind.MANDATORY, title = "יומי")
        val others = (100L..130L).map { B2.occ(it, B2.task(it, TaskKind.OPTIONAL), TODAY, OccurrenceStatus.PENDING) }
        tasks.setOccurrences(
            listOf(
                B2.occ(1, recurring, TODAY.minusDays(1), OccurrenceStatus.PENDING),
                B2.occ(2, recurring, TODAY, OccurrenceStatus.PENDING),
            ) + others,
        )
        val c = builder().build()
        assertEquals(1, c.pendingTasks.count { it.id == 7L })
        assertEquals(TODAY.minusDays(1).toString(), c.pendingTasks.first { it.id == 7L }.date)
        assertTrue(c.pendingTasks.size <= CoachContextBuilder.MAX_TITLES)
        assertEquals(c.pendingTasks.size, c.pendingTasks.map { it.id }.toSet().size)
    }

    @Test fun builder_emptyData_noRefs() = runTest {
        assertTrue(builder().build().pendingTasks.isEmpty())
    }

    @Test fun coachContext_pendingTasksDefaultsToEmpty() {
        assertTrue(CoachContext(TODAY.toString(), emptyList(), emptyList(), 0, 0, 0).pendingTasks.isEmpty())
    }

    // ---------- LocalDemoCoachScript ----------

    private val provider = LocalDemoCoachProvider(B2.timeAt(), wordDelayMillis = 0)
    private val refs = listOf(
        CoachTaskRef(11, "דוח", mandatory = true, date = TODAY.toString()),
        CoachTaskRef(12, "חשבונית", mandatory = true, date = TODAY.minusDays(2).toString()),
        CoachTaskRef(20, "ישנה יותר אך רשות", mandatory = false, date = TODAY.minusDays(5).toString()),
        CoachTaskRef(13, "באיחור קטן", mandatory = true, date = TODAY.minusDays(1).toString()),
    )
    private val ctx = CoachContext(
        TODAY.toString(), listOf("דוח", "חשבונית", "באיחור קטן"), listOf("ישנה יותר אך רשות"), 0, 0, 0, pendingTasks = refs,
    )

    private suspend fun run(msg: String, c: CoachContext = ctx): Pair<String, List<String>> {
        val chunks = provider.streamReply(emptyList(), msg, c).toList()
        assertEquals(CoachChunk.Done, chunks.last())
        return chunks.filterIsInstance<CoachChunk.TextDelta>().joinToString("") { it.text } to
            chunks.filterIsInstance<CoachChunk.ActionJson>().map { it.json }
    }

    @Test fun intentDetection_postponeKeywords() {
        listOf("דחה לי את הדוח", "אפשר לדחות משהו?", "תעזור לי להזיז משימה", "Please postpone", "reschedule my task").forEach {
            assertEquals(it, LocalDemoCoachScript.Intent.RESCHEDULE, LocalDemoCoachScript.detect(it))
        }
        // Unchanged intents.
        assertEquals(LocalDemoCoachScript.Intent.PLAN_DAY, LocalDemoCoachScript.detect("תכנן לי את היום"))
        assertEquals(LocalDemoCoachScript.Intent.MOTIVATION, LocalDemoCoachScript.detect("יש לי דחיינות היום"))
    }

    @Test fun postpone_proposesOldestOverdueMandatory_forTomorrow_andValidates() = runTest {
        val (text, actions) = run("דחה משימה")
        assertTrue(hebrew.containsMatchIn(text))
        assertTrue(text.contains(LocalDemoCoachScript.DEMO_NOTE))
        assertTrue(text.contains("חשבונית"))
        val action = CoachActionValidator.parse(actions.single(), refs.map { it.id }.toSet(), TODAY)
        assertEquals(ProposedAction.RescheduleTask(12, TODAY.plusDays(1)), action)
    }

    @Test fun postpone_withoutOverdue_fallsBackToTodaysMandatory() = runTest {
        val (_, actions) = run("postpone", ctx.copy(pendingTasks = refs.filter { it.id == 11L || it.id == 20L }))
        assertEquals(
            ProposedAction.RescheduleTask(11, TODAY.plusDays(1)),
            CoachActionValidator.parse(actions.single(), setOf(11L, 20L), TODAY),
        )
    }

    @Test fun postpone_withoutMandatoryRefs_textOnly() = runTest {
        val (text, actions) = run("להזיז", ctx.copy(pendingTasks = refs.filter { !it.mandatory }))
        assertTrue(actions.isEmpty())
        assertTrue(hebrew.containsMatchIn(text))
        assertTrue(run("reschedule", ctx.copy(pendingTasks = emptyList())).second.isEmpty())
    }

    @Test fun postpone_malformedRefDate_isIgnoredNotCrashing() = runTest {
        val bad = listOf(CoachTaskRef(99, "x", mandatory = true, date = "not-a-date"))
        assertTrue(run("דחה", ctx.copy(pendingTasks = bad)).second.isEmpty())
    }

    // ---------- end to end through CoachConversationUseCase ----------

    @Test fun endToEnd_demoReschedule_isKeptAsValidAction_andAcceptUpdatesTask() = runTest {
        seedOverdue()
        val chat = FakeChatRepository()
        val updated = mutableListOf<Pair<Long, TaskInput>>()
        val contextBuilder = builder()
        val uc = CoachConversationUseCase(
            chatRepo = chat, coach = provider, buildContext = { contextBuilder.build() }, settings = settings,
            createTask = { TaskResult.Success(1L) }, updateTask = { id, input -> updated += id to input; TaskResult.Success(Unit) },
            taskRepo = tasks, time = B2.timeAt(),
        )
        assertEquals(CoachSendState.Completed, uc.send("תדחה לי משימה").toList().last())
        val assistant = chat.messages.value.last()
        assertEquals(ChatRole.ASSISTANT, assistant.role)
        assertEquals(listOf(ProposedAction.RescheduleTask(12, TODAY.plusDays(1))), assistant.actions)
        assertEquals(TaskResult.Success(Unit), uc.acceptAction(assistant.id, 0))
        assertEquals(12L, updated.single().first)
        assertEquals(TODAY.plusDays(1), updated.single().second.startDate)
    }

    @Test fun endToEnd_rescheduleOfIdMissingFromRepository_isDropped() = runTest {
        // A stale/forged context offers id 777, but the repository does not know it → dropped, notice shown.
        val chat = FakeChatRepository()
        val stale = ctx.copy(pendingTasks = listOf(CoachTaskRef(777, "רפאים", mandatory = true, date = TODAY.minusDays(1).toString())))
        val uc = CoachConversationUseCase(
            chatRepo = chat, coach = provider, buildContext = { stale }, settings = settings,
            createTask = { TaskResult.Success(1L) }, updateTask = { _, _ -> TaskResult.Success(Unit) },
            taskRepo = tasks, time = B2.timeAt(),
        )
        uc.send("דחה").toList()
        assertTrue(chat.messages.value.first { it.role == ChatRole.ASSISTANT }.actions.isEmpty())
        assertEquals(ChatRole.NOTICE, chat.messages.value.last().role)
    }
}
