package com.disciplineos.app.enforcement

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.enforcement.ui.BlockScreen
import com.disciplineos.app.enforcement.ui.BlockScreenState
import com.disciplineos.app.enforcement.ui.BypassFeedback
import com.disciplineos.core.domain.blocker.BypassAvailability
import com.disciplineos.core.domain.blocker.BypassManager
import com.disciplineos.core.domain.blocker.BypassResult
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.AppSettings
import com.disciplineos.core.model.BlockDecision
import com.disciplineos.core.model.BypassReason
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Full-screen reminder shown over a restricted app. Not exported; started only by our own services.
 * - Back press and "home" go to the launcher (never traps the user).
 * - Finishes by itself as soon as the decision for the package becomes Allow (task completed, bypass, recovery...).
 * - Re-checks the decision on start and finishes immediately for protected packages.
 */
@AndroidEntryPoint
class BlockActivity : ComponentActivity() {

    private val viewModel: BlockViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        viewModel.bind(intent?.getStringExtra(EXTRA_PACKAGE))

        setContent {
            val ui by viewModel.state.collectAsStateWithLifecycle()
            DisciplineTheme(highContrast = ui.settings.highContrast, reduceMotion = ui.settings.reduceMotion) {
                val decision = ui.decision
                LaunchedEffect(decision) {
                    if (decision is BlockDecision.Allow) finish()
                }
                if (decision is BlockDecision.Block) {
                    BlockScreen(
                        state = BlockScreenState(
                            reason = decision.reason,
                            pending = decision.pending,
                            appLabel = ui.appLabel,
                            availability = ui.availability,
                            bypassDurationMinutes = ui.bypassDurationMinutes,
                            bypassBusy = ui.bypassBusy,
                            bypassFeedback = ui.feedback,
                            motivationIndex = motivationalIndex(System.currentTimeMillis(), Int.MAX_VALUE).let { 0 } + ui.motivationIndex,
                        ),
                        onOpenTasks = ::openTasks,
                        onGoHome = ::goHome,
                        onRequestBypass = { reason, note -> viewModel.requestBypass(reason, note) },
                        onOpenRecovery = ::openRecovery,
                    )
                } else {
                    Box(Modifier.fillMaxSize().background(DisciplineTheme.colors.background))
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        viewModel.bind(intent.getStringExtra(EXTRA_PACKAGE))
    }

    override fun onStop() {
        super.onStop()
        // Do not linger in the background; the service relaunches the screen if the restricted app returns.
        if (!isChangingConfigurations && !isFinishing) finish()
    }

    private fun openTasks() {
        startSafely(EnforcementNotifier.appLaunchIntent(this, EnforcementNotifier.ROUTE_DASHBOARD))
        finish()
    }

    private fun openRecovery() {
        startSafely(EnforcementNotifier.appLaunchIntent(this, EnforcementNotifier.ROUTE_BLOCKER))
        finish()
    }

    private fun goHome() {
        startSafely(homeIntent())
        finish()
    }

    private fun startSafely(intent: Intent) {
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // Nothing else to do; finishing still returns the user to the previous screen.
        }
    }

    companion object {
        const val EXTRA_PACKAGE = "com.disciplineos.app.extra.BLOCKED_PACKAGE"

        fun homeIntent(): Intent = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}

data class BlockUiState(
    val decision: BlockDecision? = null,
    val appLabel: String? = null,
    val availability: BypassAvailability? = null,
    val bypassDurationMinutes: Int = 10,
    val bypassBusy: Boolean = false,
    val feedback: BypassFeedback? = null,
    val motivationIndex: Int = 0,
    val settings: AppSettings = AppSettings(),
)

@HiltViewModel
class BlockViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val engine: EnforcementEngine,
    private val bypassManager: BypassManager,
    blockerRepository: BlockerRepository,
    settingsRepository: SettingsRepository,
    private val time: TimeProvider,
) : ViewModel() {

    private val pkg = MutableStateFlow<String?>(null)
    private val local = MutableStateFlow(LocalState())

    private data class LocalState(val busy: Boolean = false, val feedback: BypassFeedback? = null)
    private data class Base(val decision: BlockDecision?, val label: String?, val duration: Int)

    private val base = combine(pkg, engine.input, blockerRepository.observeConfig()) { p, input, config ->
        val decision = when {
            input == null -> null
            p == null -> engine.currentRestriction(input)
            else -> engine.evaluate(input, p)
        }
        Base(decision, p?.let(::labelOf), config.bypassDurationMinutes)
    }

    val state: StateFlow<BlockUiState> = combine(
        base,
        bypassManager.observeAvailability().map<BypassAvailability, BypassAvailability?> { it }
            .onStart { emit(null) }.catch { emit(null) },
        settingsRepository.observeSettings().onStart { emit(AppSettings()) }.catch { emit(AppSettings()) },
        local,
    ) { b, availability, settings, l ->
        BlockUiState(
            decision = b.decision,
            appLabel = b.label,
            availability = availability,
            bypassDurationMinutes = b.duration,
            bypassBusy = l.busy,
            feedback = l.feedback,
            motivationIndex = motivationalIndex(time.now().toEpochMilli(), Int.MAX_VALUE),
            settings = settings,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BlockUiState())

    fun bind(packageName: String?) {
        pkg.value = packageName
        local.value = LocalState()
    }

    fun requestBypass(reason: BypassReason, note: String) {
        if (local.value.busy) return
        local.update { it.copy(busy = true, feedback = null) }
        viewModelScope.launch {
            val result = runCatching { bypassManager.request(reason, note.take(200)) }.getOrNull()
            when (result) {
                is BypassResult.Granted -> local.update { it.copy(busy = false) } // decision flips to Allow -> finish
                is BypassResult.Denied -> local.update {
                    it.copy(busy = false, feedback = BypassFeedback.Denied(result.denial, result.retryAt))
                }
                null -> local.update { it.copy(busy = false, feedback = BypassFeedback.Error) }
            }
        }
    }

    private fun labelOf(packageName: String): String? = try {
        val pm = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }
}
