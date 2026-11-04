package com.disciplineos.app.data

import android.content.Context
import android.net.Uri
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.Configuration
import androidx.work.ListenableWorker
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.disciplineos.app.data.backup.BackupCodec
import com.disciplineos.app.data.backup.BackupFormatException
import com.disciplineos.app.data.backup.BackupManagerImpl
import com.disciplineos.app.data.local.DisciplineDatabase
import com.disciplineos.app.data.prefs.SettingsRepositoryImpl
import com.disciplineos.app.data.repository.BlockerRepositoryImpl
import com.disciplineos.app.data.repository.ChatRepositoryImpl
import com.disciplineos.app.data.repository.FocusRepositoryImpl
import com.disciplineos.app.data.repository.GamificationRepositoryImpl
import com.disciplineos.app.data.repository.TaskRepositoryImpl
import com.disciplineos.app.work.MaintenanceScheduler
import com.disciplineos.core.domain.time.ClockTimeProvider
import com.disciplineos.core.model.AppLanguage
import com.disciplineos.core.model.BlockedApp
import com.disciplineos.core.model.ChatMessage
import com.disciplineos.core.model.ChatRole
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.SubTask
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.TaskOccurrence
import com.disciplineos.core.model.XpEvent
import com.disciplineos.core.model.XpSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class BackupManagerTest {

    /** Maintenance work enqueued after import must not run real workers in this test. */
    class NoOpWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
        override fun doWork(): Result = Result.success()
    }

    private lateinit var context: Context
    private lateinit var db: DisciplineDatabase
    private lateinit var dataStore: DataStore<Preferences>
    private lateinit var dataStoreScope: CoroutineScope
    private lateinit var manager: BackupManagerImpl
    private lateinit var tasks: TaskRepositoryImpl
    private lateinit var settings: SettingsRepositoryImpl
    private lateinit var blocker: BlockerRepositoryImpl
    private lateinit var chat: ChatRepositoryImpl
    private lateinit var gamification: GamificationRepositoryImpl
    private lateinit var file: File

    private val now = Instant.parse("2026-11-04T08:00:00Z")
    private val today = LocalDate.of(2026, 11, 4)

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder()
                .setExecutor(SynchronousExecutor())
                .setWorkerFactory(object : WorkerFactory() {
                    override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker =
                        NoOpWorker(appContext, workerParameters)
                })
                .build(),
        )
        db = Room.inMemoryDatabaseBuilder(context, DisciplineDatabase::class.java).build()
        dataStoreScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        dataStore = PreferenceDataStoreFactory.create(scope = dataStoreScope) {
            File(context.cacheDir, "backup-test-${UUID.randomUUID()}.preferences_pb")
        }
        val time = ClockTimeProvider(Clock.fixed(now, ZoneId.of("UTC")))
        val io = Dispatchers.IO
        tasks = TaskRepositoryImpl(db, db.taskDao(), io)
        settings = SettingsRepositoryImpl(dataStore)
        blocker = BlockerRepositoryImpl(db, db.blockerDao(), dataStore, io)
        chat = ChatRepositoryImpl(db.chatDao(), io)
        gamification = GamificationRepositoryImpl(db.gamificationDao(), time, io)
        manager = BackupManagerImpl(
            context = context,
            db = db,
            dao = db.backupDao(),
            settingsRepository = settings,
            blockerRepository = blocker,
            focusRepository = FocusRepositoryImpl(db.focusDao(), dataStore, io),
            maintenance = MaintenanceScheduler(WorkManager.getInstance(context)),
            time = time,
            io = io,
        )
        file = File(context.cacheDir, "backup-${UUID.randomUUID()}.json")
    }

    @After
    fun tearDown() {
        db.close()
        dataStoreScope.cancel()
        file.delete()
    }

    private suspend fun seed(): Long {
        val dep = tasks.upsertTask(Task(title = "dep", startDate = today, zoneId = "UTC", createdAt = now, updatedAt = now))
        val id = tasks.upsertTask(
            Task(title = "משימה", kind = TaskKind.MANDATORY, startDate = today, zoneId = "Asia/Jerusalem", dependsOn = setOf(dep),
                reminderOffsetsMinutes = listOf(15), createdAt = now, updatedAt = now),
        )
        tasks.replaceSubTasks(id, listOf(SubTask(taskId = id, title = "a"), SubTask(taskId = id, title = "b", done = true)))
        tasks.insertOccurrencesIfAbsent(listOf(TaskOccurrence(taskId = id, localDate = today, dueAt = now, status = OccurrenceStatus.PENDING)))
        settings.updateSettings { it.copy(language = AppLanguage.ENGLISH, onboardingCompleted = true) }
        blocker.updateConfig { it.copy(enabled = true, maxBypassesPerDay = 1) }
        blocker.setBlockedApps(listOf(BlockedApp("com.instagram.android", "Instagram")))
        gamification.awardXp(XpEvent(at = now, amount = 20, source = XpSource.TASK_COMPLETED, dedupeKey = "occ:1"))
        chat.insertMessage(ChatMessage(role = ChatRole.USER, text = "private chat", createdAt = now))
        return id
    }

    @Test
    fun exportThenImport_roundTripsAllBackedUpData_andExcludesChat() = runTest {
        val taskId = seed()
        val before = manager.readSnapshot()
        val written = manager.exportTo(Uri.fromFile(file)).getOrThrow()
        assertEquals(before.recordCount, written)
        assertTrue(!file.readText().contains("private chat"))

        // Change everything, then restore.
        tasks.deleteTask(taskId)
        settings.updateSettings { it.copy(language = AppLanguage.HEBREW) }
        blocker.updateConfig { it.copy(enabled = false) }

        val imported = manager.importFrom(Uri.fromFile(file)).getOrThrow()
        assertEquals(written, imported)
        val after = manager.readSnapshot()
        assertEquals(before.copy(dependencies = before.dependencies.sortedBy { it.taskId }), after.copy(dependencies = after.dependencies.sortedBy { it.taskId }))
        assertEquals(AppLanguage.ENGLISH, settings.observeSettings().first().language)
        assertTrue(blocker.observeConfig().first().enabled)
        assertEquals(listOf("a", "b"), tasks.observeSubTasks(taskId).first().map { it.title })
        // Chat history is not part of a backup and is left untouched by an import.
        assertEquals(1, chat.observeMessages().first().size)
    }

    @Test
    fun invalidFile_isRejected_andLeavesDataUntouched() = runTest {
        seed()
        val before = manager.readSnapshot()
        file.writeText("""{"schemaVersion": 99, "app": "discipline-os", "exportedAt": "2026-11-04T08:00:00Z"}""")
        val result = manager.importFrom(Uri.fromFile(file))
        assertTrue(result.isFailure)
        assertEquals(BackupFormatException.Reason.UNSUPPORTED_SCHEMA_VERSION, (result.exceptionOrNull() as BackupFormatException).reason)
        assertEquals(before, manager.readSnapshot())
    }

    @Test
    fun oversizedFile_isRejectedWhileStreaming() = runTest {
        file.outputStream().use { out ->
            val chunk = ByteArray(1024 * 1024) { ' '.code.toByte() }
            repeat(BackupCodec.MAX_BYTES / chunk.size + 1) { out.write(chunk) }
        }
        val result = manager.importFrom(Uri.fromFile(file))
        assertEquals(BackupFormatException.Reason.TOO_LARGE, (result.exceptionOrNull() as BackupFormatException).reason)
    }
}
