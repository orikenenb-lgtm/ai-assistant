package com.disciplineos.app.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.disciplineos.app.data.local.DisciplineDatabase
import com.disciplineos.app.data.repository.GamificationRepositoryImpl
import com.disciplineos.app.data.repository.TaskRepositoryImpl
import com.disciplineos.core.domain.time.ClockTimeProvider
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.SubTask
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskHistoryEntry
import com.disciplineos.core.model.TaskHistoryType
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.TaskOccurrence
import com.disciplineos.core.model.XpEvent
import com.disciplineos.core.model.XpSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

@RunWith(AndroidJUnit4::class)
class DaoTest {

    private lateinit var db: DisciplineDatabase
    private lateinit var tasks: TaskRepositoryImpl
    private lateinit var gamification: GamificationRepositoryImpl

    private val now = Instant.parse("2026-11-04T08:00:00Z")
    private val today = LocalDate.of(2026, 11, 4)

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, DisciplineDatabase::class.java).build()
        tasks = TaskRepositoryImpl(db, db.taskDao(), Dispatchers.IO)
        gamification = GamificationRepositoryImpl(db.gamificationDao(), ClockTimeProvider(Clock.fixed(now, ZoneId.of("UTC"))), Dispatchers.IO)
    }

    @After
    fun tearDown() = db.close()

    private fun task(title: String, kind: TaskKind = TaskKind.MANDATORY, archived: Boolean = false, dependsOn: Set<Long> = emptySet()) =
        Task(title = title, kind = kind, startDate = today, zoneId = "UTC", archived = archived, dependsOn = dependsOn, createdAt = now, updatedAt = now)

    private fun occ(taskId: Long, date: LocalDate, status: OccurrenceStatus = OccurrenceStatus.PENDING) =
        TaskOccurrence(taskId = taskId, localDate = date, dueAt = null, status = status)

    @Test
    fun insertOccurrencesIfAbsent_isIdempotent_andNeverOverwrites() = runTest {
        val id = tasks.upsertTask(task("a"))
        tasks.insertOccurrencesIfAbsent(listOf(occ(id, today), occ(id, today.plusDays(1))))
        val first = tasks.getOccurrences(id, today, today.plusDays(1))
        tasks.insertOccurrencesIfAbsent(listOf(occ(id, today, OccurrenceStatus.COMPLETED), occ(id, today), occ(id, today.plusDays(2))))
        val all = tasks.getOccurrences(id, LocalDate.of(1970, 1, 1), LocalDate.of(9999, 12, 31))
        assertEquals(3, all.size)
        assertEquals(first[0], all[0]) // same id, still PENDING
        assertEquals(OccurrenceStatus.PENDING, all[0].status)
    }

    @Test
    fun deleteTask_cascadesChildren_butKeepsHistory() = runTest {
        val dep = tasks.upsertTask(task("dep"))
        val id = tasks.upsertTask(task("main", dependsOn = setOf(dep)))
        tasks.replaceSubTasks(id, listOf(SubTask(taskId = id, title = "s1"), SubTask(taskId = id, title = "s2")))
        tasks.insertOccurrencesIfAbsent(listOf(occ(id, today)))
        tasks.appendHistory(TaskHistoryEntry(taskId = id, occurrenceId = null, type = TaskHistoryType.DELETED, at = now))

        assertEquals(setOf(dep), tasks.getTask(id)!!.dependsOn)
        tasks.deleteTask(dep) // removes the dependency edge only
        assertEquals(emptySet<Long>(), tasks.getTask(id)!!.dependsOn)

        tasks.deleteTask(id)
        assertNull(tasks.getTask(id))
        assertTrue(tasks.observeSubTasks(id).first().isEmpty())
        assertTrue(tasks.getOccurrences(id, LocalDate.of(1970, 1, 1), LocalDate.of(9999, 12, 31)).isEmpty())
        assertEquals(1, tasks.observeHistory(id).first().size)
    }

    @Test
    fun upsertExistingTask_updatesInPlace_withoutLosingOccurrences() = runTest {
        val id = tasks.upsertTask(task("before"))
        tasks.insertOccurrencesIfAbsent(listOf(occ(id, today)))
        tasks.replaceSubTasks(id, listOf(SubTask(taskId = id, title = "keep")))
        val sub = tasks.observeSubTasks(id).first().single()

        assertEquals(id, tasks.upsertTask(tasks.getTask(id)!!.copy(title = "after")))
        assertEquals("after", tasks.getTask(id)!!.title)
        assertEquals(1, tasks.getOccurrences(id, today, today).size)

        // replaceSubTasks keeps ids of retained rows and deletes the rest.
        tasks.replaceSubTasks(id, listOf(sub.copy(title = "kept"), SubTask(taskId = id, title = "new")))
        val subs = tasks.observeSubTasks(id).first()
        assertEquals(listOf("kept", "new"), subs.map { it.title })
        assertEquals(sub.id, subs[0].id)
    }

    @Test
    fun observeOpenOccurrences_returnsPendingAndMissed_onOrBefore_nonArchived() = runTest {
        val a = tasks.upsertTask(task("a"))
        val archived = tasks.upsertTask(task("archived", archived = true))
        tasks.insertOccurrencesIfAbsent(
            listOf(
                occ(a, today.minusDays(2), OccurrenceStatus.MISSED),
                occ(a, today.minusDays(1), OccurrenceStatus.COMPLETED),
                occ(a, today, OccurrenceStatus.PENDING),
                occ(a, today.plusDays(1), OccurrenceStatus.PENDING),
                occ(a, today.minusDays(3), OccurrenceStatus.SKIPPED),
                occ(archived, today, OccurrenceStatus.PENDING),
            ),
        )
        tasks.replaceSubTasks(a, listOf(SubTask(taskId = a, title = "x")))
        val open = tasks.observeOpenOccurrences(today).first()
        assertEquals(listOf(today.minusDays(2), today), open.map { it.occurrence.localDate })
        assertTrue(open.all { it.task.id == a && it.subTasks.size == 1 })

        val window = tasks.observeOccurrences(today.minusDays(3), today.plusDays(1)).first()
        assertEquals(6, window.size)
        assertEquals(window.map { it.occurrence.localDate }.sorted(), window.map { it.occurrence.localDate })
    }

    @Test
    fun updateOccurrence_persistsV2Columns() = runTest {
        val id = tasks.upsertTask(task("a"))
        tasks.insertOccurrencesIfAbsent(listOf(occ(id, today)))
        val o = tasks.getOccurrences(id, today, today).single()
        tasks.updateOccurrence(o.copy(status = OccurrenceStatus.COMPLETED, completedAt = now, snoozeCount = 2, verificationNote = "note"))
        val back = tasks.getOccurrence(o.id)!!
        assertEquals(2, back.snoozeCount)
        assertEquals("note", back.verificationNote)
        assertEquals(now, back.completedAt)
    }

    @Test
    fun xpAwards_areDeduplicated_achievementsAndFreezesIdempotent() = runTest {
        val e = XpEvent(at = now, amount = 20, source = XpSource.TASK_COMPLETED, dedupeKey = "occ:1")
        assertTrue(gamification.awardXp(e))
        assertFalse(gamification.awardXp(e.copy(amount = 999)))
        assertEquals(listOf(20), gamification.observeXpEvents().first().map { it.amount })

        assertTrue(gamification.unlockAchievement("first", now))
        assertFalse(gamification.unlockAchievement("first", now.plusSeconds(10)))
        assertEquals(now, gamification.observeAchievements().first().single().unlockedAt)

        gamification.recordStreakFreezeUsed(today)
        gamification.recordStreakFreezeUsed(today)
        assertEquals(1, gamification.streakFreezesUsed())
    }

    @Test
    fun upsertCategory_insertsThenUpdates() = runTest {
        val id = tasks.upsertCategory(com.disciplineos.core.model.Category(name = "a", colorHex = "#000000", iconKey = "k"))
        assertNotNull(id)
        assertEquals(id, tasks.upsertCategory(com.disciplineos.core.model.Category(id = id, name = "b", colorHex = "#000000", iconKey = "k")))
        assertEquals(listOf("b"), tasks.observeCategories().first().map { it.name })
    }
}
