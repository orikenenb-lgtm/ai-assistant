package com.disciplineos.core.domain.integration

import com.disciplineos.core.domain.blocker.BlockPolicyEngine
import com.disciplineos.core.domain.blocker.ObserveBlockPolicyInputUseCase
import com.disciplineos.core.domain.coach.CoachContextBuilder
import com.disciplineos.core.domain.coach.CoachConversationUseCase
import com.disciplineos.core.domain.coach.LocalDemoCoachProvider
import com.disciplineos.core.domain.focus.FocusSessionManager
import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.domain.task.FakeReminderScheduler
import com.disciplineos.core.domain.task.FakeTaskRepository
import com.disciplineos.core.domain.task.OccurrenceMaterializer
import com.disciplineos.core.domain.task.TaskCommands
import com.disciplineos.core.domain.task.TaskInput
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.domain.task.fixedTime
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import com.disciplineos.core.domain.blocker.FakeBlockerRepository as BlockerRepoFake
import com.disciplineos.core.domain.focus.FakeFocusRepository as FocusRepoFake
import com.disciplineos.core.domain.gamification.FakeChatRepository
import com.disciplineos.core.domain.gamification.FakeGamificationRepository
import com.disciplineos.core.domain.gamification.FakeSettingsRepository

/**
 * Wires the REAL production classes through their public @Inject constructors (the same graph Hilt builds),
 * crossing the boundaries owned by different agents: TaskCommands ↔ GamificationService ↔ blocker policy ↔ coach.
 */
class CrossModuleIntegrationTest {
    private val today = LocalDate.of(2026, 11, 4)
    private val time = fixedTime(today, LocalTime.of(10, 0))
    private val ownPkg = "com.disciplineos.app"
    private val instagram = "com.instagram.android"

    private val taskRepo = FakeTaskRepository()
    private val gamRepo = FakeGamificationRepository()
    private val focusRepo = FocusRepoFake()
    private val blockerRepo = BlockerRepoFake(BlockerConfig(enabled = true))
    private val gamification = GamificationService(gamRepo, taskRepo, focusRepo, time)
    private val commands = TaskCommands(taskRepo, time, OccurrenceMaterializer(taskRepo, time), gamification, FakeReminderScheduler())
    private val focus = FocusSessionManager(focusRepo, time, gamification)
    private val policyInput = ObserveBlockPolicyInputUseCase(taskRepo, blockerRepo, focus, time)

    private suspend fun decision(pkg: String = instagram): BlockDecision =
        BlockPolicyEngine.decide(policyInput(ownPkg, emptySet()).first(), pkg)

    private fun input(title: String, kind: TaskKind) = TaskInput(title = title, kind = kind, startDate = today)

    @Test
    fun mandatoryLifecycle_blocksUntilCompleted_thenUnblocksAndAwardsXp() = runTest {
        blockerRepo.setBlockedApps(listOf(BlockedApp(instagram, "Instagram")))
        assertEquals(BlockDecision.Allow(AllowReason.NO_ACTIVE_MANDATORY), decision(), "no tasks → no block")

        val created = commands.createTask(input("להגיש עבודה בהיסטוריה", TaskKind.MANDATORY))
        assertIs<TaskResult.Success<Long>>(created)

        val blocked = decision()
        assertIs<BlockDecision.Block>(blocked)
        assertEquals(BlockReason.MANDATORY_TASKS_PENDING, blocked.reason)
        assertEquals(listOf("להגיש עבודה בהיסטוריה"), blocked.pending.map { it.title })

        // Safety: the dialer and our own app are never blocked, even while restriction is active.
        assertEquals(BlockDecision.Allow(AllowReason.PROTECTED_PACKAGE), decision("com.android.dialer"))
        assertEquals(BlockDecision.Allow(AllowReason.PROTECTED_PACKAGE), decision(ownPkg))

        val occurrence = taskRepo.occurrences.single()
        assertIs<TaskResult.Success<Unit>>(commands.completeOccurrence(occurrence.id))

        assertEquals(BlockDecision.Allow(AllowReason.NO_ACTIVE_MANDATORY), decision(), "all mandatory done → unblocked")
        val keys = gamRepo.events.value.map { it.dedupeKey }
        assertTrue("occ:${occurrence.id}" in keys, "task XP awarded: $keys")
        assertTrue(keys.any { it.startsWith("day:") }, "mandatory-day-cleared XP awarded: $keys")
        assertTrue(gamification.observeProgress().first().totalXp > 0)
    }

    @Test
    fun optionalTasksNeverBlock_andUncompleteRestoresBlockWithoutDoubleXp() = runTest {
        blockerRepo.setBlockedApps(listOf(BlockedApp(instagram, "Instagram")))
        commands.createTask(input("לקרוא ספר", TaskKind.OPTIONAL))
        assertEquals(BlockDecision.Allow(AllowReason.NO_ACTIVE_MANDATORY), decision())

        commands.createTask(input("אימון", TaskKind.MANDATORY))
        val mandatoryOcc = taskRepo.occurrences.first { taskRepo.tasks[it.taskId]!!.kind == TaskKind.MANDATORY }
        commands.completeOccurrence(mandatoryOcc.id)
        assertIs<BlockDecision.Allow>(decision())
        val xpAfterFirst = gamRepo.events.value.size

        commands.uncompleteOccurrence(mandatoryOcc.id)
        assertIs<BlockDecision.Block>(decision(), "reopening a mandatory task re-applies the block deterministically")
        commands.completeOccurrence(mandatoryOcc.id)
        assertEquals(xpAfterFirst, gamRepo.events.value.size, "XP is idempotent across complete/uncomplete")
    }

    @Test
    fun coachSuggestion_isWrittenOnlyAfterExplicitApproval_andOnlyOnce() = runTest {
        val settings = FakeSettingsRepository()
        val chat = FakeChatRepository()
        val coach = CoachConversationUseCase(
            chatRepo = chat,
            coach = LocalDemoCoachProvider(time),
            contextBuilder = CoachContextBuilder(taskRepo, focusRepo, gamification, settings, time),
            settings = settings,
            taskCommands = commands,
            taskRepo = taskRepo,
            time = time,
        )
        commands.createTask(input("מבחן במתמטיקה", TaskKind.MANDATORY))
        val before = taskRepo.tasks.size

        coach.send("תכנן לי את היום").toList()
        val assistant = chat.messages.value.last { it.role == ChatRole.ASSISTANT }
        assertTrue(assistant.actions.isNotEmpty(), "demo coach proposes an action")
        assertEquals(before, taskRepo.tasks.size, "nothing is written before approval")

        assertIs<TaskResult.Success<Unit>>(coach.acceptAction(assistant.id, 0))
        assertEquals(before + 1, taskRepo.tasks.size)
        coach.acceptAction(assistant.id, 0)
        assertEquals(before + 1, taskRepo.tasks.size, "double tap does not create a duplicate")
        val stored = chat.messages.value.first { it.id == assistant.id }.actions[0]
        assertEquals(ActionStatus.ACCEPTED, stored.status)
    }
}
