package com.disciplineos.app.data.backup

import android.content.Context
import android.net.Uri
import androidx.room.withTransaction
import com.disciplineos.app.data.local.DisciplineDatabase
import com.disciplineos.app.data.local.dao.BackupDao
import com.disciplineos.app.di.IoDispatcher
import com.disciplineos.app.work.MaintenanceScheduler
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.time.TimeProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import javax.inject.Inject
import javax.inject.Singleton

/** Contract used by the Settings screen (agent D). The UI asks for confirmation before calling [importFrom]. */
interface BackupManager {
    /** Writes a JSON backup to [uri] (from ACTION_CREATE_DOCUMENT). Returns the number of records written. */
    suspend fun exportTo(uri: android.net.Uri): Result<Int>

    /**
     * Validates the file at [uri] completely, then REPLACES all backed-up data in one transaction.
     * On any failure nothing is changed. Returns the number of records imported.
     * Failure exceptions: [BackupFormatException] (invalid file) or IOException (unreadable).
     */
    suspend fun importFrom(uri: android.net.Uri): Result<Int>
}

@Singleton
class BackupManagerImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: DisciplineDatabase,
    private val dao: BackupDao,
    private val settingsRepository: SettingsRepository,
    private val blockerRepository: BlockerRepository,
    private val focusRepository: FocusRepository,
    private val maintenance: MaintenanceScheduler,
    private val time: TimeProvider,
    @IoDispatcher private val io: CoroutineDispatcher,
) : BackupManager {

    override suspend fun exportTo(uri: Uri): Result<Int> = runCatchingNonCancel {
        val snapshot = readSnapshot()
        val text = BackupCodec.encode(snapshot, time.now())
        withContext(io) {
            val out = context.contentResolver.openOutputStream(uri, "wt") ?: throw IOException("Cannot open output")
            out.use { it.write(text.toByteArray(Charsets.UTF_8)) }
        }
        snapshot.recordCount
    }

    override suspend fun importFrom(uri: Uri): Result<Int> = runCatchingNonCancel {
        val text = withContext(io) {
            val input = context.contentResolver.openInputStream(uri) ?: throw IOException("Cannot open input")
            input.use { readCapped(it, BackupCodec.MAX_BYTES) }.toString(Charsets.UTF_8)
        }
        val snapshot = withContext(io) { BackupCodec.decode(text) } // throws before anything is touched
        applySnapshot(snapshot)
        maintenance.enqueueMaterializeNow() // re-materialise window + reschedule reminders for imported tasks
        snapshot.recordCount
    }

    internal suspend fun readSnapshot(): BackupSnapshot {
        val settings = settingsRepository.observeSettings().first()
        val blockerConfig = blockerRepository.observeConfig().first()
        val focusConfig = focusRepository.observeConfig().first()
        // One read transaction so the table snapshot is consistent.
        return db.withTransaction {
            BackupSnapshot(
                settings = settings,
                blockerConfig = blockerConfig,
                focusConfig = focusConfig,
                categories = dao.allCategories(),
                tasks = dao.allTasks(),
                dependencies = dao.allDependencies(),
                subTasks = dao.allSubTasks(),
                occurrences = dao.allOccurrences(),
                history = dao.allHistory(),
                blockedApps = dao.allBlockedApps(),
                focusSessions = dao.allFocusSessions(),
                xpEvents = dao.allXpEvents(),
                achievements = dao.allAchievements(),
                streakFreezes = dao.allStreakFreezes(),
            )
        }
    }

    /**
     * DB part is atomic (one transaction). Preferences are written after the commit; DataStore cannot join a
     * SQLite transaction, so a crash in between leaves new data with old settings — harmless and re-importable.
     */
    internal suspend fun applySnapshot(s: BackupSnapshot) {
        db.withTransaction {
            dao.deleteDependencies()
            dao.deleteSubTasks()
            dao.deleteOccurrences()
            dao.deleteHistory()
            dao.deleteTasks()
            dao.deleteCategories()
            dao.deleteBlockedApps()
            dao.deleteFocusSessions()
            dao.deleteXpEvents()
            dao.deleteAchievements()
            dao.deleteStreakFreezes()

            dao.insertCategories(s.categories)
            dao.insertTasks(s.tasks)
            dao.insertDependencies(s.dependencies)
            dao.insertSubTasks(s.subTasks)
            dao.insertOccurrences(s.occurrences)
            dao.insertHistory(s.history)
            dao.insertBlockedApps(s.blockedApps)
            dao.insertFocusSessions(s.focusSessions)
            dao.insertXpEvents(s.xpEvents)
            dao.insertAchievements(s.achievements)
            dao.insertStreakFreezes(s.streakFreezes)
        }
        s.settings?.let { imported -> settingsRepository.updateSettings { imported } }
        // Imported config never enables enforcement: the user re-enables it via the blocker screen, which checks permissions.
        s.blockerConfig?.let { imported -> blockerRepository.updateConfig { imported.copy(enabled = false) } }
        s.focusConfig?.let { imported -> focusRepository.updateConfig { imported } }
    }

    private inline fun <T> runCatchingNonCancel(block: () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }

    companion object {
        /** Reads at most [maxBytes]; throws [BackupFormatException] (TOO_LARGE) if the stream is longer. */
        internal fun readCapped(input: InputStream, maxBytes: Int): ByteArray {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                total += n
                if (total > maxBytes) throw BackupFormatException(BackupFormatException.Reason.TOO_LARGE)
                out.write(buffer, 0, n)
            }
            return out.toByteArray()
        }
    }
}
