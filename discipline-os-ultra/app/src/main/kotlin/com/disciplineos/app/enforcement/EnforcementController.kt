package com.disciplineos.app.enforcement

import android.app.ForegroundServiceStartNotAllowedException
import android.content.Context
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.disciplineos.core.domain.repository.BlockerRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Starts / stops [EnforcementService] from the persisted [com.disciplineos.core.model.BlockerConfig.enabled] flag.
 *
 * Contract (AGENTS.md §5): `sync()` is called from DisciplineApp.onCreate and from BootReceiver. It is idempotent,
 * never throws, and after the first call keeps following config changes and process foreground transitions
 * (so a start that Android refused in the background is retried as soon as the user opens the app).
 */
@Singleton
class EnforcementController @Inject constructor(
    @ApplicationContext private val context: Context,
    private val blockerRepository: BlockerRepository,
    private val notifier: EnforcementNotifier,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val observing = AtomicBoolean(false)

    fun sync() {
        startObservingOnce()
        scope.launch { runCatching { syncNow() } }
    }

    /** Suspending variant for callers that must wait (BootReceiver with goAsync). */
    suspend fun syncNow() {
        val enabled = blockerRepository.observeConfig().first().enabled
        apply(enabled)
    }

    private fun startObservingOnce() {
        if (!observing.compareAndSet(false, true)) return
        scope.launch {
            runCatching {
                blockerRepository.observeConfig()
                    .map { it.enabled }
                    .distinctUntilChanged()
                    .collect { apply(it) }
            }
        }
        scope.launch(Dispatchers.Main) {
            runCatching {
                ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
                    override fun onStart(owner: LifecycleOwner) {
                        // App came to the foreground: FGS starts are always allowed now.
                        scope.launch { runCatching { syncNow() } }
                    }
                })
            }
        }
    }

    private suspend fun apply(enabled: Boolean) = withContext(Dispatchers.Main) {
        if (enabled) start() else stop()
    }

    private fun start() {
        try {
            ContextCompat.startForegroundService(context, EnforcementService.intent(context))
        } catch (e: IllegalStateException) {
            // Android 12+: ForegroundServiceStartNotAllowedException (subclass of IllegalStateException) when the
            // app is in the background without an exemption. Older: "Not allowed to start service" ISE.
            // Either way the fallback is the same: a notification asking the user to open the app (which re-syncs).
            val denied = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || Api31.isFgsStartNotAllowed(e) ||
                e.message.orEmpty().contains("not allowed", ignoreCase = true)
            if (denied) notifier.postStartPrompt()
        } catch (_: SecurityException) {
            notifier.postStartPrompt()
        }
    }

    private fun stop() {
        notifier.cancelStartPrompt()
        notifier.cancelBlockAlert()
        runCatching { context.stopService(EnforcementService.intent(context)) }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private object Api31 {
        fun isFgsStartNotAllowed(e: Throwable): Boolean = e is ForegroundServiceStartNotAllowedException
    }
}
