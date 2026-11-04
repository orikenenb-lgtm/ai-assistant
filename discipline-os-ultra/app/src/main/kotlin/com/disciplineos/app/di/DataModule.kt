package com.disciplineos.app.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.room.Room
import androidx.work.WorkManager
import com.disciplineos.app.data.backup.BackupManager
import com.disciplineos.app.data.backup.BackupManagerImpl
import com.disciplineos.app.data.local.DisciplineDatabase
import com.disciplineos.app.data.local.Migrations
import com.disciplineos.app.data.local.dao.BackupDao
import com.disciplineos.app.data.local.dao.BlockerDao
import com.disciplineos.app.data.local.dao.ChatDao
import com.disciplineos.app.data.local.dao.FocusDao
import com.disciplineos.app.data.local.dao.GamificationDao
import com.disciplineos.app.data.local.dao.TaskDao
import com.disciplineos.app.data.prefs.PrefKeys
import com.disciplineos.app.data.prefs.SettingsRepositoryImpl
import com.disciplineos.app.data.repository.BlockerRepositoryImpl
import com.disciplineos.app.data.repository.ChatRepositoryImpl
import com.disciplineos.app.data.repository.DataWipeRepositoryImpl
import com.disciplineos.app.data.repository.FocusRepositoryImpl
import com.disciplineos.app.data.repository.GamificationRepositoryImpl
import com.disciplineos.app.data.repository.TaskRepositoryImpl
import com.disciplineos.app.work.WorkManagerReminderScheduler
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.ChatRepository
import com.disciplineos.core.domain.repository.DataWipeRepository
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.GamificationRepository
import com.disciplineos.core.domain.repository.ReminderScheduler
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.SystemTimeProvider
import com.disciplineos.core.domain.time.TimeProvider
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import javax.inject.Singleton

/** Data-layer providers (E). Repository/scheduler interface bindings are in [DataBindingsModule]. */
@Module
@InstallIn(SingletonComponent::class)
object DataModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): DisciplineDatabase =
        Room.databaseBuilder(context, DisciplineDatabase::class.java, DisciplineDatabase.NAME)
            .addMigrations(*Migrations.ALL)
            // No fallbackToDestructiveMigration(): a missing migration must fail loudly in testing,
            // never silently delete a user's data.
            .build()

    @Provides fun provideTaskDao(db: DisciplineDatabase): TaskDao = db.taskDao()
    @Provides fun provideBlockerDao(db: DisciplineDatabase): BlockerDao = db.blockerDao()
    @Provides fun provideFocusDao(db: DisciplineDatabase): FocusDao = db.focusDao()
    @Provides fun provideGamificationDao(db: DisciplineDatabase): GamificationDao = db.gamificationDao()
    @Provides fun provideChatDao(db: DisciplineDatabase): ChatDao = db.chatDao()
    @Provides fun provideBackupDao(db: DisciplineDatabase): BackupDao = db.backupDao()

    /** The single Preferences DataStore. Exactly one instance per file per process is required by DataStore. */
    @Provides
    @Singleton
    fun providePreferencesDataStore(
        @ApplicationContext context: Context,
        @IoDispatcher io: CoroutineDispatcher,
    ): DataStore<Preferences> = PreferenceDataStoreFactory.create(
        corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
        scope = CoroutineScope(io + SupervisorJob()),
        produceFile = { context.preferencesDataStoreFile(PrefKeys.DATASTORE_NAME) },
    )

    @Provides
    @Singleton
    fun provideTimeProvider(): TimeProvider = SystemTimeProvider

    /** Requires DisciplineApp to implement Configuration.Provider (default initializer is removed in the manifest). */
    @Provides
    @Singleton
    fun provideWorkManager(@ApplicationContext context: Context): WorkManager = WorkManager.getInstance(context)

    @Provides
    @IoDispatcher
    fun provideIoDispatcher(): CoroutineDispatcher = Dispatchers.IO

    /**
     * Process-wide scope. Failures of fire-and-forget work are contained (SupervisorJob) and reported to
     * logcat by exception type only — no message text, which could contain user content.
     */
    @Provides
    @Singleton
    @ApplicationScope
    fun provideApplicationScope(): CoroutineScope = CoroutineScope(
        SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, e ->
            android.util.Log.e("DisciplineApp", "Background task failed: ${e.javaClass.name}")
        },
    )
}

@Module
@InstallIn(SingletonComponent::class)
abstract class DataBindingsModule {
    @Binds @Singleton abstract fun bindTaskRepository(impl: TaskRepositoryImpl): TaskRepository
    @Binds @Singleton abstract fun bindBlockerRepository(impl: BlockerRepositoryImpl): BlockerRepository
    @Binds @Singleton abstract fun bindFocusRepository(impl: FocusRepositoryImpl): FocusRepository
    @Binds @Singleton abstract fun bindGamificationRepository(impl: GamificationRepositoryImpl): GamificationRepository
    @Binds @Singleton abstract fun bindSettingsRepository(impl: SettingsRepositoryImpl): SettingsRepository
    @Binds @Singleton abstract fun bindChatRepository(impl: ChatRepositoryImpl): ChatRepository
    @Binds @Singleton abstract fun bindDataWipeRepository(impl: DataWipeRepositoryImpl): DataWipeRepository
    @Binds @Singleton abstract fun bindReminderScheduler(impl: WorkManagerReminderScheduler): ReminderScheduler
    @Binds @Singleton abstract fun bindBackupManager(impl: BackupManagerImpl): BackupManager
}
