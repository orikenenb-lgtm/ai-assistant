package com.disciplineos.app

import android.app.Application
import android.os.StrictMode
import android.util.Log
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.disciplineos.app.di.ApplicationScope
import com.disciplineos.app.enforcement.EnforcementController
import com.disciplineos.app.focus.FocusStateObserver
import com.disciplineos.app.notifications.NotificationChannelsInitializer
import com.disciplineos.app.work.MaintenanceScheduler
import com.disciplineos.core.domain.focus.FocusSessionManager
import com.disciplineos.core.domain.repository.ReminderScheduler
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Application entry point. WorkManager is initialised on demand through [Configuration.Provider] with the
 * Hilt worker factory (the default initializer is removed in AndroidManifest.xml).
 */
@HiltAndroidApp
class DisciplineApp : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var channels: NotificationChannelsInitializer
    @Inject lateinit var maintenance: MaintenanceScheduler
    @Inject lateinit var reminderScheduler: ReminderScheduler
    @Inject lateinit var focusSessionManager: FocusSessionManager
    @Inject lateinit var focusStateObserver: FocusStateObserver
    @Inject lateinit var enforcementController: EnforcementController
    @Inject @ApplicationScope lateinit var appScope: CoroutineScope

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(if (BuildConfig.DEBUG) Log.INFO else Log.ERROR)
            .build()

    override fun onCreate() {
        if (BuildConfig.DEBUG) enableStrictMode()
        super.onCreate() // Hilt injects fields here.

        channels.createAll()

        maintenance.enqueuePeriodic()
        maintenance.enqueueMaterializeNow()

        appScope.launch { focusSessionManager.restore() }
        focusStateObserver.start(appScope)
        enforcementController.sync()
        appScope.launch { reminderScheduler.rescheduleAll() }
    }

    private fun enableStrictMode() {
        StrictMode.setThreadPolicy(
            StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().build(),
        )
        StrictMode.setVmPolicy(
            StrictMode.VmPolicy.Builder()
                .detectLeakedClosableObjects()
                .detectLeakedSqlLiteObjects()
                .detectActivityLeaks()
                .penaltyLog()
                .build(),
        )
    }
}
