package com.disciplineos.app.data.repository

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import com.disciplineos.app.data.local.DisciplineDatabase
import com.disciplineos.app.data.security.SecureStore
import com.disciplineos.app.di.IoDispatcher
import com.disciplineos.app.work.MaintenanceScheduler
import com.disciplineos.core.domain.focus.FocusSessionManager
import com.disciplineos.core.domain.repository.DataWipeRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * "Delete all my data". Order matters:
 * 1. stop the live focus timer (so it does not re-persist state after the wipe);
 * 2. cancel all WorkManager jobs (no worker writes mid-wipe) and visible notifications;
 * 3. clear every Room table; 4. clear secrets + Keystore key; 5. clear all preferences;
 * 6. re-enqueue the (data-free) periodic maintenance work so a fresh start behaves normally.
 * The blocker turns itself off: EnforcementController observes BlockerConfig, which reverts to defaults (disabled).
 */
@Singleton
class DataWipeRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: DisciplineDatabase,
    private val dataStore: DataStore<Preferences>,
    private val secureStore: SecureStore,
    private val maintenance: MaintenanceScheduler,
    private val focusSessionManager: FocusSessionManager,
    private val enforcementPrefs: com.disciplineos.app.enforcement.EnforcementPrefs,
    @IoDispatcher private val io: CoroutineDispatcher,
) : DataWipeRepository {

    override suspend fun wipeAll() {
        try {
            focusSessionManager.stop()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Best effort: the running state is cleared from DataStore below anyway.
        }
        maintenance.cancelEverything()
        NotificationManagerCompat.from(context).cancelAll()
        withContext(io) { db.clearAllTables() } // must not run on the main thread
        secureStore.clearAll()
        enforcementPrefs.clear()
        dataStore.edit { it.clear() }
        maintenance.enqueuePeriodic()
    }
}
