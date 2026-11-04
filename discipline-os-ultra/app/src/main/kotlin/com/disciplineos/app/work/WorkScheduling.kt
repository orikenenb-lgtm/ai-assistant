package com.disciplineos.app.work

import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.time.Duration
import java.time.LocalTime
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Work names / tags owned by the data layer. */
object WorkNames {
    const val MATERIALIZE_PERIODIC = "materialize-daily"
    const val MATERIALIZE_NOW = "materialize-now"
    const val DAILY_SUMMARY_PERIODIC = "daily-summary"
    const val TAG_REMINDER = "reminder"
    const val TAG_MAINTENANCE = "maintenance"
    fun taskTag(taskId: Long) = "task-$taskId"
    const val NAME_TAG_PREFIX = "rname:"
    const val FIRE_TAG_PREFIX = "fire:"
}

/** Pure time helpers (JVM-tested). */
object WorkTiming {
    /** Delay from [now] until the next occurrence of local [at] (strictly in the future; DST-aware via ZonedDateTime). */
    fun delayUntilNext(now: ZonedDateTime, at: LocalTime): Duration {
        var next = now.toLocalDate().atTime(at).atZone(now.zone)
        if (!next.isAfter(now)) next = now.toLocalDate().plusDays(1).atTime(at).atZone(now.zone)
        return Duration.between(now, next)
    }

    /** Shortly after local midnight, so "yesterday" is final when the daily materialisation runs. */
    val MATERIALIZE_AT: LocalTime = LocalTime.of(0, 15)
    val DAILY_SUMMARY_AT: LocalTime = LocalTime.of(20, 30)
}

/**
 * Enqueues the long-lived maintenance work. All calls are idempotent (unique work + KEEP).
 * Periodic work drifts with WorkManager's flex window and across DST changes by up to an hour; that is
 * acceptable for maintenance and a summary (reminders use exact one-time work instead).
 */
@Singleton
class MaintenanceScheduler @Inject constructor(
    private val workManager: WorkManager,
) {
    fun enqueuePeriodic(now: ZonedDateTime = ZonedDateTime.now()) {
        val materialize = PeriodicWorkRequestBuilder<MaterializeWorker>(1, TimeUnit.DAYS)
            .setInitialDelay(WorkTiming.delayUntilNext(now, WorkTiming.MATERIALIZE_AT).toMillis(), TimeUnit.MILLISECONDS)
            .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build())
            .addTag(WorkNames.TAG_MAINTENANCE)
            .build()
        workManager.enqueueUniquePeriodicWork(WorkNames.MATERIALIZE_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, materialize)

        val summary = PeriodicWorkRequestBuilder<DailySummaryWorker>(1, TimeUnit.DAYS)
            .setInitialDelay(WorkTiming.delayUntilNext(now, WorkTiming.DAILY_SUMMARY_AT).toMillis(), TimeUnit.MILLISECONDS)
            .addTag(WorkNames.TAG_MAINTENANCE)
            .build()
        workManager.enqueueUniquePeriodicWork(WorkNames.DAILY_SUMMARY_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, summary)
    }

    /** One immediate materialisation (app start, after import). No constraints: it is cheap and local. */
    fun enqueueMaterializeNow() {
        val request = OneTimeWorkRequestBuilder<MaterializeWorker>()
            .addTag(WorkNames.TAG_MAINTENANCE)
            .build()
        workManager.enqueueUniqueWork(WorkNames.MATERIALIZE_NOW, ExistingWorkPolicy.REPLACE, request)
    }

    /** Cancels every WorkManager job of the app (used by "delete all my data"), then prunes finished records. */
    fun cancelEverything() {
        workManager.cancelAllWork()
        workManager.pruneWork()
    }
}
