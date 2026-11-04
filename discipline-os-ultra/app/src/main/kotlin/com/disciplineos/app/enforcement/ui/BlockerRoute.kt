package com.disciplineos.app.enforcement.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsListRow
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.component.DsSectionHeader
import com.disciplineos.app.designsystem.component.DsSwitchRow
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.enforcement.BypassBounds
import com.disciplineos.app.enforcement.EnforcementController
import com.disciplineos.app.enforcement.EnforcementEngine
import com.disciplineos.app.enforcement.EnforcementHealth
import com.disciplineos.app.enforcement.EnforcementMode
import com.disciplineos.app.enforcement.EnforcementNotifier
import com.disciplineos.app.enforcement.EnforcementPrefs
import com.disciplineos.app.enforcement.enforcementStatusOf
import com.disciplineos.core.domain.blocker.RecoveryModeUseCase
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.BlockerConfig
import com.disciplineos.core.model.BypassReason
import com.disciplineos.core.model.BypassSession
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject

data class BlockerUiState(
    val loading: Boolean = true,
    val config: BlockerConfig = BlockerConfig(),
    val blockedCount: Int = 0,
    val permissions: PermissionSnapshot? = null,
    val mode: EnforcementMode = EnforcementMode.USAGE_STATS,
    val accessibilityConsented: Boolean = false,
    val statusText: String = "",
    val health: EnforcementHealth = EnforcementHealth(),
    val bypasses: List<BypassSession> = emptyList(),
    val now: Instant = Instant.now(),
)

sealed interface BlockerEvent {
    data object NavigateToPermissions : BlockerEvent
    data object OpenAccessibilitySettings : BlockerEvent
}

@HiltViewModel
class BlockerViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val blockerRepository: BlockerRepository,
    private val prefs: EnforcementPrefs,
    private val engine: EnforcementEngine,
    private val controller: EnforcementController,
    private val notifier: EnforcementNotifier,
    private val recovery: RecoveryModeUseCase,
    private val time: TimeProvider,
) : ViewModel() {

    private val permissions = MutableStateFlow(PermissionChecks.snapshot(context))
    private val _events = Channel<BlockerEvent>(Channel.BUFFERED)
    val events: Flow<BlockerEvent> = _events.receiveAsFlow()

    private data class Data(
        val config: BlockerConfig,
        val blockedCount: Int,
        val bypasses: List<BypassSession>,
    )

    private val data: Flow<Data> = combine(
        blockerRepository.observeConfig(),
        blockerRepository.observeBlockedApps(),
        blockerRepository.observeBypasses(time.now().minus(Duration.ofDays(7))),
    ) { config, apps, bypasses ->
        Data(config, apps.count { it.enabled }, bypasses.sortedByDescending { it.startedAt })
    }

    private val enforcement = combine(
        engine.restriction,
        engine.input,
        engine.health,
    ) { restriction, input, health -> Triple(restriction, input, health) }

    val state: StateFlow<BlockerUiState> = combine(
        data,
        enforcement.onStart { emit(Triple(null, null, EnforcementHealth())) }.catch { },
        permissions,
        prefs.mode,
        prefs.accessibilityConsentAt,
    ) { d, (restriction, input, health), perms, mode, consent ->
        val status = if (!d.config.enabled) {
            context.getString(R.string.blocker_status_off)
        } else if (input == null || restriction == null) {
            context.getString(R.string.blocker_status_loading)
        } else {
            notifier.statusText(enforcementStatusOf(restriction, input, health))
        }
        BlockerUiState(
            loading = false,
            config = d.config,
            blockedCount = d.blockedCount,
            permissions = perms,
            mode = mode,
            accessibilityConsented = consent != null,
            statusText = status,
            health = health,
            bypasses = d.bypasses,
            now = time.now(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BlockerUiState())

    fun refreshPermissions() {
        permissions.value = PermissionChecks.snapshot(context)
        controller.sync()
    }

    private fun readyToEnable(): Boolean {
        val p = PermissionChecks.snapshot(context).also { permissions.value = it }
        return if (prefs.mode.value == EnforcementMode.ACCESSIBILITY && prefs.accessibilityConsented) {
            p.accessibilityEnabled
        } else {
            p.usageModeReady
        }
    }

    fun setEnabled(enabled: Boolean) {
        viewModelScope.launch {
            if (enabled && !readyToEnable()) {
                _events.send(BlockerEvent.NavigateToPermissions)
                return@launch
            }
            // Turning the blocker OFF is always one tap, without friction: the user is never locked in.
            blockerRepository.updateConfig { it.copy(enabled = enabled) }
            controller.sync()
        }
    }

    fun setCarryOver(value: Boolean) = update { it.copy(carryOverOverdue = value) }
    fun setBlockDuringFocus(value: Boolean) = update { it.copy(blockDuringFocus = value) }
    fun changeBypassDuration(delta: Int) = update {
        it.copy(bypassDurationMinutes = BypassBounds.clampDuration(it.bypassDurationMinutes + delta))
    }
    fun changeMaxBypasses(delta: Int) = update {
        it.copy(maxBypassesPerDay = BypassBounds.clampMaxPerDay(it.maxBypassesPerDay + delta))
    }
    fun changeCooldown(delta: Int) = update {
        it.copy(bypassCooldownMinutes = BypassBounds.clampCooldown(it.bypassCooldownMinutes + delta))
    }

    fun selectUsageMode() = prefs.setMode(EnforcementMode.USAGE_STATS)

    /** Returns true if the disclosure must be shown first. */
    fun selectAccessibilityMode(): Boolean {
        if (!prefs.accessibilityConsented) return true
        prefs.setMode(EnforcementMode.ACCESSIBILITY)
        if (!PermissionChecks.accessibilityServiceEnabled(context)) {
            viewModelScope.launch { _events.send(BlockerEvent.OpenAccessibilitySettings) }
        }
        return false
    }

    fun acceptAccessibilityDisclosure() {
        prefs.giveAccessibilityConsent()
        prefs.setMode(EnforcementMode.ACCESSIBILITY)
        viewModelScope.launch { _events.send(BlockerEvent.OpenAccessibilitySettings) }
    }

    fun withdrawAccessibilityConsent() = prefs.withdrawAccessibilityConsent()

    fun enableRecovery(hours: Int) {
        viewModelScope.launch { runCatching { recovery.enable(BypassBounds.clampRecoveryHours(hours)) } }
    }

    fun disableRecovery() {
        viewModelScope.launch { runCatching { recovery.disable() } }
    }

    private fun update(transform: (BlockerConfig) -> BlockerConfig) {
        viewModelScope.launch { blockerRepository.updateConfig(transform) }
    }
}

@Composable
fun BlockerRoute(
    onOpenApps: () -> Unit,
    onOpenPermissions: () -> Unit,
    onBack: () -> Unit,
    viewModel: BlockerViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    var showDisclosure by rememberSaveable { mutableStateOf(false) }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refreshPermissions() }
    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                BlockerEvent.NavigateToPermissions -> onOpenPermissions()
                BlockerEvent.OpenAccessibilitySettings -> PermissionIntents.open(context, PermissionKind.ACCESSIBILITY)
            }
        }
    }

    BlockerScreen(
        state = state,
        onBack = onBack,
        onOpenApps = onOpenApps,
        onOpenPermissions = onOpenPermissions,
        onSetEnabled = viewModel::setEnabled,
        onSelectUsage = viewModel::selectUsageMode,
        onSelectAccessibility = { if (viewModel.selectAccessibilityMode()) showDisclosure = true },
        onWithdrawConsent = viewModel::withdrawAccessibilityConsent,
        onCarryOver = viewModel::setCarryOver,
        onBlockDuringFocus = viewModel::setBlockDuringFocus,
        onDuration = viewModel::changeBypassDuration,
        onMaxPerDay = viewModel::changeMaxBypasses,
        onCooldown = viewModel::changeCooldown,
        onEnableRecovery = viewModel::enableRecovery,
        onDisableRecovery = viewModel::disableRecovery,
    )

    if (showDisclosure) {
        AccessibilityDisclosureDialog(
            onAccept = {
                showDisclosure = false
                viewModel.acceptAccessibilityDisclosure()
            },
            onDecline = { showDisclosure = false },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BlockerScreen(
    state: BlockerUiState,
    onBack: () -> Unit,
    onOpenApps: () -> Unit,
    onOpenPermissions: () -> Unit,
    onSetEnabled: (Boolean) -> Unit,
    onSelectUsage: () -> Unit,
    onSelectAccessibility: () -> Unit,
    onWithdrawConsent: () -> Unit,
    onCarryOver: (Boolean) -> Unit,
    onBlockDuringFocus: (Boolean) -> Unit,
    onDuration: (Int) -> Unit,
    onMaxPerDay: (Int) -> Unit,
    onCooldown: (Int) -> Unit,
    onEnableRecovery: (Int) -> Unit,
    onDisableRecovery: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val config = state.config
    val zone = ZoneId.systemDefault()
    val timeFmt = DateTimeFormatter.ofPattern("HH:mm")
    val dateTimeFmt = DateTimeFormatter.ofPattern("d.M HH:mm")
    var showLimits by rememberSaveable { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(colors.background)) {
        DsTopBar(title = stringResource(R.string.blocker_title), onBack = onBack)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = spacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(spacing.md),
        ) {
            // Master switch + status
            DsCard(modifier = Modifier.fillMaxWidth()) {
                DsSwitchRow(
                    title = stringResource(R.string.blocker_master_switch),
                    subtitle = stringResource(R.string.blocker_master_switch_sub),
                    checked = config.enabled,
                    onCheckedChange = onSetEnabled,
                    enabled = !state.loading,
                )
                Spacer(Modifier.height(spacing.sm))
                Text(
                    text = stringResource(R.string.blocker_status_header),
                    style = DisciplineTheme.typography.labelLarge,
                    color = colors.textMuted,
                )
                Text(
                    text = state.statusText,
                    style = DisciplineTheme.typography.bodyLarge,
                    color = if (state.health.degraded && config.enabled) colors.warning else colors.textPrimary,
                )
                if (state.health.degraded && config.enabled) {
                    TextButton(onClick = onOpenPermissions) {
                        Text(stringResource(R.string.blocker_status_degraded), color = colors.warning)
                    }
                }
            }

            // Apps + permissions
            DsCard(modifier = Modifier.fillMaxWidth(), contentPadding = PaddingValues(vertical = spacing.xs)) {
                DsListRow(
                    title = stringResource(R.string.blocker_choose_apps),
                    subtitle = if (state.blockedCount > 0) {
                        stringResource(R.string.blocker_apps_count, state.blockedCount)
                    } else {
                        stringResource(R.string.blocker_apps_none)
                    },
                    leadingIcon = Icons.Filled.Apps,
                    onClick = onOpenApps,
                )
                DsListRow(
                    title = stringResource(R.string.blocker_permissions),
                    subtitle = stringResource(
                        if (state.permissions?.usageModeReady == true) R.string.perm_ready else R.string.perm_not_ready,
                    ),
                    leadingIcon = Icons.Filled.Security,
                    onClick = onOpenPermissions,
                )
            }

            // Detection mode
            DsSectionHeader(title = stringResource(R.string.blocker_mode_header))
            DsCard(modifier = Modifier.fillMaxWidth()) {
                ModeOption(
                    selected = state.mode == EnforcementMode.USAGE_STATS,
                    title = stringResource(R.string.blocker_mode_usage),
                    subtitle = stringResource(R.string.blocker_mode_usage_sub),
                    onClick = onSelectUsage,
                )
                ModeOption(
                    selected = state.mode == EnforcementMode.ACCESSIBILITY,
                    title = stringResource(R.string.blocker_mode_a11y),
                    subtitle = stringResource(R.string.blocker_mode_a11y_sub),
                    onClick = onSelectAccessibility,
                )
                val a11yOn = state.permissions?.accessibilityEnabled == true
                if (state.mode == EnforcementMode.ACCESSIBILITY) {
                    TextButton(onClick = onSelectAccessibility) {
                        Text(
                            text = stringResource(
                                if (a11yOn) R.string.blocker_mode_a11y_status_on else R.string.blocker_mode_a11y_status_off,
                            ),
                            color = if (a11yOn) colors.success else colors.warning,
                        )
                    }
                }
                if (a11yOn && !state.accessibilityConsented) {
                    Text(
                        text = stringResource(R.string.a11y_enabled_without_consent),
                        style = DisciplineTheme.typography.bodySmall,
                        color = colors.warning,
                    )
                }
                if (state.accessibilityConsented) {
                    TextButton(onClick = onWithdrawConsent) {
                        Text(stringResource(R.string.a11y_withdraw_consent), color = colors.textSecondary)
                    }
                }
            }

            // Rules
            DsSectionHeader(title = stringResource(R.string.blocker_rules_header))
            DsCard(modifier = Modifier.fillMaxWidth()) {
                DsSwitchRow(
                    title = stringResource(R.string.blocker_carry_over),
                    subtitle = stringResource(R.string.blocker_carry_over_sub),
                    checked = config.carryOverOverdue,
                    onCheckedChange = onCarryOver,
                )
                DsSwitchRow(
                    title = stringResource(R.string.blocker_focus),
                    subtitle = stringResource(R.string.blocker_focus_sub),
                    checked = config.blockDuringFocus,
                    onCheckedChange = onBlockDuringFocus,
                )
            }

            // Bypass settings
            DsSectionHeader(title = stringResource(R.string.blocker_bypass_header))
            DsCard(modifier = Modifier.fillMaxWidth()) {
                Stepper(
                    text = stringResource(R.string.blocker_bypass_duration, config.bypassDurationMinutes),
                    canDecrease = config.bypassDurationMinutes > BypassBounds.DURATION_MINUTES.first,
                    canIncrease = config.bypassDurationMinutes < BypassBounds.DURATION_MINUTES.last,
                    onDecrease = { onDuration(-BypassBounds.DURATION_STEP) },
                    onIncrease = { onDuration(BypassBounds.DURATION_STEP) },
                )
                Stepper(
                    text = stringResource(R.string.blocker_bypass_max, config.maxBypassesPerDay),
                    canDecrease = config.maxBypassesPerDay > BypassBounds.MAX_PER_DAY.first,
                    canIncrease = config.maxBypassesPerDay < BypassBounds.MAX_PER_DAY.last,
                    onDecrease = { onMaxPerDay(-1) },
                    onIncrease = { onMaxPerDay(1) },
                )
                Stepper(
                    text = stringResource(R.string.blocker_bypass_cooldown, config.bypassCooldownMinutes),
                    canDecrease = config.bypassCooldownMinutes > BypassBounds.COOLDOWN_MINUTES.first,
                    canIncrease = config.bypassCooldownMinutes < BypassBounds.COOLDOWN_MINUTES.last,
                    onDecrease = { onCooldown(-BypassBounds.COOLDOWN_STEP) },
                    onIncrease = { onCooldown(BypassBounds.COOLDOWN_STEP) },
                )
                Text(
                    text = stringResource(R.string.bypass_emergency_always),
                    style = DisciplineTheme.typography.bodySmall,
                    color = colors.textMuted,
                )
            }

            // Transparent history
            DsSectionHeader(title = stringResource(R.string.blocker_history_header))
            DsCard(modifier = Modifier.fillMaxWidth()) {
                if (state.bypasses.isEmpty()) {
                    Text(
                        text = stringResource(R.string.blocker_history_empty),
                        style = DisciplineTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                    )
                } else {
                    state.bypasses.take(30).forEach { b ->
                        val end = b.endedEarlyAt ?: b.endsAt
                        val minutes = Duration.between(b.startedAt, end).toMinutes().coerceAtLeast(0).toInt()
                        Column(Modifier.padding(vertical = spacing.xs)) {
                            Text(
                                text = stringResource(
                                    R.string.blocker_history_item,
                                    reasonText(b.reason),
                                    dateTimeFmt.format(b.startedAt.atZone(zone)),
                                    minutes,
                                ),
                                style = DisciplineTheme.typography.bodyMedium,
                                color = colors.textPrimary,
                            )
                            val extra = listOfNotNull(
                                b.note.takeIf { it.isNotBlank() },
                                if (b.endedEarlyAt != null) stringResource(R.string.blocker_history_ended_early) else null,
                            ).joinToString(" • ")
                            if (extra.isNotEmpty()) {
                                Text(extra, style = DisciplineTheme.typography.bodySmall, color = colors.textMuted)
                            }
                        }
                    }
                }
            }

            // Recovery mode
            DsSectionHeader(title = stringResource(R.string.blocker_recovery_header))
            DsCard(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = stringResource(R.string.blocker_recovery_explain),
                    style = DisciplineTheme.typography.bodyMedium,
                    color = colors.textSecondary,
                )
                Spacer(Modifier.height(spacing.sm))
                val until = config.recoveryUntil?.takeIf { it.isAfter(state.now) }
                if (until != null) {
                    Text(
                        text = stringResource(R.string.blocker_recovery_active, timeFmt.format(until.atZone(zone))),
                        style = DisciplineTheme.typography.bodyLarge,
                        color = colors.success,
                    )
                    DsSecondaryButton(text = stringResource(R.string.blocker_recovery_disable), onClick = onDisableRecovery)
                } else {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(spacing.sm), verticalArrangement = Arrangement.spacedBy(spacing.sm)) {
                        listOf(1, 4, 24, 72).forEach { h ->
                            DsChip(
                                label = stringResource(R.string.blocker_recovery_hours, h),
                                selected = false,
                                onClick = { onEnableRecovery(h) },
                            )
                        }
                    }
                }
            }

            // Honest limits
            TextButton(onClick = { showLimits = !showLimits }) {
                Text(stringResource(R.string.blocker_limits_link), color = colors.primarySoft)
            }
            if (showLimits) {
                Text(
                    text = stringResource(R.string.blocker_limits_text),
                    style = DisciplineTheme.typography.bodyMedium,
                    color = colors.textSecondary,
                )
            }
            Spacer(Modifier.height(spacing.xxl))
        }
    }
}

@Composable
private fun ModeOption(selected: Boolean, title: String, subtitle: String, onClick: () -> Unit) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = spacing.minTouch)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(vertical = spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(spacing.sm),
    ) {
        RadioButton(selected = selected, onClick = null)
        Column(Modifier.weight(1f)) {
            Text(title, style = DisciplineTheme.typography.titleSmall, color = colors.textPrimary)
            Text(subtitle, style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
        }
    }
}

@Composable
private fun Stepper(
    text: String,
    canDecrease: Boolean,
    canIncrease: Boolean,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = DisciplineTheme.spacing.minTouch),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = DisciplineTheme.typography.bodyLarge, color = colors.textPrimary, modifier = Modifier.weight(1f))
        IconButton(onClick = onDecrease, enabled = canDecrease) {
            Icon(Icons.Filled.Remove, contentDescription = stringResource(R.string.blocker_decrease), tint = colors.textSecondary)
        }
        IconButton(onClick = onIncrease, enabled = canIncrease) {
            Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.blocker_increase), tint = colors.primarySoft)
        }
    }
}

@Composable
private fun reasonText(reason: BypassReason): String = stringResource(
    when (reason) {
        BypassReason.EMERGENCY -> R.string.bypass_reason_emergency
        BypassReason.WORK_OR_STUDY -> R.string.bypass_reason_work
        BypassReason.HEALTH -> R.string.bypass_reason_health
        BypassReason.OTHER -> R.string.bypass_reason_other
    },
)
