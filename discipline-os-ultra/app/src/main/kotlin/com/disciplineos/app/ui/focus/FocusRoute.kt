package com.disciplineos.app.ui.focus

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsConfirmDialog
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.FocusPhase
import kotlin.math.abs

/** Navigation entry point (see Routes.FOCUS). */
@Composable
fun FocusRoute(viewModel: FocusViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    FocusScreen(
        state = state,
        onSelectTask = viewModel::selectTask,
        onStart = viewModel::start,
        onPause = viewModel::pause,
        onResume = viewModel::resume,
        onSkip = viewModel::skip,
        onStop = viewModel::stop,
        onSaveConfig = viewModel::updateConfig,
        onDismissError = viewModel::dismissError,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FocusScreen(
    state: FocusUiState,
    onSelectTask: (Long?) -> Unit,
    onStart: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onSkip: () -> Unit,
    onStop: () -> Unit,
    onSaveConfig: (FocusConfig) -> Unit,
    onDismissError: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    var showSettings by rememberSaveable { mutableStateOf(false) }
    var confirmStop by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val errorText = state.errorRes?.let { stringResource(it) }

    LaunchedEffect(errorText) {
        if (errorText != null) {
            snackbar.showSnackbar(errorText)
            onDismissError()
        }
    }

    Scaffold(
        containerColor = colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            DsTopBar(
                title = stringResource(R.string.feat_focus_title),
                actions = {
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Filled.Tune, contentDescription = stringResource(R.string.feat_focus_settings_open))
                    }
                },
            )
        },
    ) { padding ->
        if (state.loading) {
            DsLoadingState(Modifier.padding(padding).fillMaxSize(), message = stringResource(R.string.feat_loading))
        } else Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = spacing.screenGutter, vertical = spacing.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(spacing.lg),
        ) {
            CountdownDial(state = state)
            SessionDots(
                filled = state.filledDots,
                total = state.config.sessionsBeforeLongBreak,
                completedTotal = state.completedWorkSessions,
            )

            state.displayTaskTitle?.let { title ->
                Text(
                    text = stringResource(R.string.feat_focus_working_on, title),
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.textSecondary,
                    textAlign = TextAlign.Center,
                )
            }

            Controls(
                state = state,
                onStart = onStart,
                onPause = onPause,
                onResume = onResume,
                onSkip = onSkip,
                onStop = { if (state.phase == FocusPhase.WORK) confirmStop = true else onStop() },
            )

            if (state.phase == FocusPhase.IDLE) {
                TaskPicker(state = state, onSelectTask = onSelectTask)
            }

            BlockerInfoLine(state)
        }
    }

    if (confirmStop) {
        DsConfirmDialog(
            title = stringResource(R.string.feat_focus_stop_title),
            message = stringResource(R.string.feat_focus_stop_message),
            confirmLabel = stringResource(R.string.feat_focus_stop_confirm),
            dismissLabel = stringResource(R.string.feat_focus_stop_keep),
            onConfirm = {
                confirmStop = false
                onStop()
            },
            onDismiss = { confirmStop = false },
        )
    }

    if (showSettings) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        var draft by remember(state.config) { mutableStateOf(state.config) }
        ModalBottomSheet(
            onDismissRequest = { showSettings = false },
            sheetState = sheetState,
            containerColor = colors.surface,
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = spacing.xl)
                    .padding(bottom = spacing.xl)
                    .navigationBarsPadding(),
                verticalArrangement = Arrangement.spacedBy(spacing.md),
            ) {
                Text(
                    stringResource(R.string.feat_focus_settings_title),
                    style = MaterialTheme.typography.titleLarge,
                    color = colors.textPrimary,
                    modifier = Modifier.semantics { heading() },
                )
                if (state.phase != FocusPhase.IDLE) {
                    Text(
                        stringResource(R.string.feat_focus_settings_next_phase_note),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                    )
                }
                FocusConfigEditor(config = draft, onChange = { draft = it })
                DsPrimaryButton(
                    text = stringResource(R.string.feat_save),
                    onClick = {
                        onSaveConfig(draft)
                        showSettings = false
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun phaseLabel(phase: FocusPhase): String = when (phase) {
    FocusPhase.IDLE -> stringResource(R.string.feat_focus_phase_idle)
    FocusPhase.WORK -> stringResource(R.string.feat_focus_phase_work)
    FocusPhase.SHORT_BREAK -> stringResource(R.string.feat_focus_phase_short_break)
    FocusPhase.LONG_BREAK -> stringResource(R.string.feat_focus_phase_long_break)
}

@Composable
private fun CountdownDial(state: FocusUiState) {
    val colors = DisciplineTheme.colors
    val motion = DisciplineTheme.motion
    val accent = when (state.phase) {
        FocusPhase.WORK -> colors.primary
        FocusPhase.SHORT_BREAK, FocusPhase.LONG_BREAK -> colors.success
        FocusPhase.IDLE -> colors.primarySoft
    }
    val accentEnd = when (state.phase) {
        FocusPhase.WORK -> colors.xp
        FocusPhase.SHORT_BREAK, FocusPhase.LONG_BREAK -> colors.primarySoft
        FocusPhase.IDLE -> colors.primary
    }

    // Smooth 1s linear interpolation between ticks; large jumps (phase change, skip) snap instantly.
    val animated = remember { Animatable(state.elapsedFraction) }
    LaunchedEffect(state.elapsedFraction, motion.reduceMotion, state.running) {
        val target = state.elapsedFraction
        if (motion.reduceMotion || !state.running || abs(target - animated.value) > 0.2f) {
            animated.snapTo(target)
        } else {
            animated.animateTo(target, tween(durationMillis = 1_000, easing = LinearEasing))
        }
    }

    val phaseText = phaseLabel(state.phase)
    val minutesLeft = FocusFormat.minutesLeftRoundedUp(state.remainingMillis)
    val a11y = when {
        state.phase == FocusPhase.IDLE -> stringResource(R.string.feat_focus_a11y_idle, minutesLeft)
        state.paused -> stringResource(R.string.feat_focus_a11y_paused, phaseText, minutesLeft)
        else -> stringResource(R.string.feat_focus_a11y_running, phaseText, minutesLeft)
    }
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            // Announce on minute changes only (the description changes once per minute), politely.
            .clearAndSetSemantics {
                contentDescription = a11y
                liveRegion = LiveRegionMode.Polite
            },
        contentAlignment = Alignment.Center,
    ) {
        val dial = minOf(maxWidth, 300.dp)
        Box(Modifier.size(dial).aspectRatio(1f), contentAlignment = Alignment.Center) {
            val track = colors.surfaceSunken
            Canvas(Modifier.fillMaxSize()) {
                val strokePx = 18.dp.toPx()
                val inset = strokePx / 2f + 4.dp.toPx()
                val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
                val topLeft = Offset(inset, inset)
                drawArc(
                    color = track,
                    startAngle = 0f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokePx),
                )
                // Remaining time shrinks the arc. Direction follows reading direction (counter-clockwise in RTL).
                val remainingSweep = 360f * (1f - animated.value)
                if (remainingSweep > 0.1f) {
                    drawArc(
                        brush = Brush.sweepGradient(listOf(accent, accentEnd, accent), center = center),
                        startAngle = -90f,
                        sweepAngle = if (rtl) -remainingSweep else remainingSweep,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = strokePx, cap = StrokeCap.Round),
                    )
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = phaseText,
                    style = MaterialTheme.typography.titleMedium,
                    color = accent,
                )
                Spacer(Modifier.height(DisciplineTheme.spacing.xs))
                Text(
                    text = FocusFormat.clock(state.remainingMillis),
                    style = MaterialTheme.typography.displayLarge.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.textPrimary,
                    textAlign = TextAlign.Center,
                    fontSize = 64.sp,
                )
                if (state.paused) {
                    Text(
                        text = stringResource(R.string.feat_focus_paused),
                        style = MaterialTheme.typography.labelLarge,
                        color = colors.warning,
                    )
                }
            }
        }
    }
}

@Composable
private fun SessionDots(filled: Int, total: Int, completedTotal: Int) {
    val colors = DisciplineTheme.colors
    val description = stringResource(R.string.feat_focus_dots_a11y, filled, total, completedTotal)
    Row(
        horizontalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.clearAndSetSemantics { contentDescription = description },
    ) {
        repeat(total.coerceAtLeast(1)) { index ->
            Box(
                Modifier
                    .size(12.dp)
                    .clip(CircleShape)
                    .background(if (index < filled) colors.success else colors.surfaceSunken),
            )
        }
        if (completedTotal > 0) {
            Spacer(Modifier.width(DisciplineTheme.spacing.sm))
            Text(
                stringResource(R.string.feat_focus_sessions_today, completedTotal),
                style = MaterialTheme.typography.labelMedium,
                color = colors.textSecondary,
            )
        }
    }
}

@Composable
private fun Controls(
    state: FocusUiState,
    onStart: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onSkip: () -> Unit,
    onStop: () -> Unit,
) {
    val spacing = DisciplineTheme.spacing
    when {
        state.phase == FocusPhase.IDLE -> DsPrimaryButton(
            text = stringResource(R.string.feat_focus_start),
            onClick = onStart,
            icon = Icons.Filled.PlayArrow,
            loading = state.busy,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        )
        else -> Column(verticalArrangement = Arrangement.spacedBy(spacing.sm)) {
            if (state.paused) {
                DsPrimaryButton(
                    text = stringResource(R.string.feat_focus_resume),
                    onClick = onResume,
                    icon = Icons.Filled.PlayArrow,
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                DsPrimaryButton(
                    text = stringResource(R.string.feat_focus_pause),
                    onClick = onPause,
                    icon = Icons.Filled.Pause,
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(spacing.sm), modifier = Modifier.fillMaxWidth()) {
                DsSecondaryButton(
                    text = stringResource(R.string.feat_focus_skip),
                    onClick = onSkip,
                    icon = Icons.Filled.SkipNext,
                    enabled = !state.busy,
                    modifier = Modifier.weight(1f),
                )
                DsSecondaryButton(
                    text = stringResource(R.string.feat_focus_stop),
                    onClick = onStop,
                    icon = Icons.Filled.Stop,
                    enabled = !state.busy,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun TaskPicker(state: FocusUiState, onSelectTask: (Long?) -> Unit) {
    val colors = DisciplineTheme.colors
    DsCard(modifier = Modifier.fillMaxWidth()) {
        Text(
            stringResource(R.string.feat_focus_pick_task),
            style = MaterialTheme.typography.titleSmall,
            color = colors.textPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(DisciplineTheme.spacing.sm))
        if (state.openTasks.isEmpty()) {
            Text(
                stringResource(R.string.feat_focus_no_open_tasks),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textSecondary,
            )
        } else {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.sm),
                contentPadding = PaddingValues(vertical = DisciplineTheme.spacing.xs),
            ) {
                item(key = "none") {
                    DsChip(
                        label = stringResource(R.string.feat_focus_no_task),
                        selected = state.selectedTaskId == null,
                        onClick = { onSelectTask(null) },
                    )
                }
                items(state.openTasks, key = { it.taskId }) { option ->
                    DsChip(
                        label = if (option.mandatory) stringResource(R.string.feat_focus_task_mandatory, option.title) else option.title,
                        selected = state.selectedTaskId == option.taskId,
                        onClick = { onSelectTask(option.taskId) },
                    )
                }
            }
        }
    }
}

@Composable
private fun BlockerInfoLine(state: FocusUiState) {
    val colors = DisciplineTheme.colors
    val text = when {
        !state.blockerConfig.enabled -> stringResource(R.string.feat_focus_blocker_off)
        state.blockerConfig.blockDuringFocus -> stringResource(R.string.feat_focus_blocker_on)
        else -> stringResource(R.string.feat_focus_blocker_focus_off)
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.sm),
        modifier = Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) {},
    ) {
        Icon(
            Icons.Filled.Block,
            contentDescription = null,
            tint = if (state.blockerConfig.enabled && state.blockerConfig.blockDuringFocus) colors.warning else colors.textMuted,
            modifier = Modifier.size(18.dp),
        )
        Text(text, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
    }
}
