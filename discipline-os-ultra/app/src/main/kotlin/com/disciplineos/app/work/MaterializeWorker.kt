package com.disciplineos.app.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.ReminderScheduler
import com.disciplineos.core.domain.task.OccurrenceMaterializer
import com.disciplineos.core.domain.time.TimeProvider
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first

/**
 * Daily (and on app start): create occurrences for the rolling window, resolve past ones, award
 * "day cleared" for yesterday, then refresh reminders for the next 48h. Every step is idempotent, so
 * running it twice (periodic + on-start) is harmless.
 */
@HiltWorker
class MaterializeWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val materializer: OccurrenceMaterializer,
    private val blockerRepository: BlockerRepository,
    private val gamification: GamificationService,
    private val reminders: ReminderScheduler,
    private val time: TimeProvider,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = try {
        materializer.materializeWindow()
        val config = blockerRepository.observeConfig().first()
        materializer.sweepPast(config.carryOverOverdue)
        gamification.checkDayCleared(time.today().minusDays(1))
        reminders.rescheduleAll()
        Result.success()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        if (runAttemptCount < MAX_RETRIES) Result.retry() else Result.failure()
    }

    private companion object {
        const val MAX_RETRIES = 3
    }
}
