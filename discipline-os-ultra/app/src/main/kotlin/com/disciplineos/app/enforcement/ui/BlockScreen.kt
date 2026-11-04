package com.disciplineos.app.enforcement.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringArrayResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsBadge
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.component.DsTextField
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.core.domain.blocker.BypassAvailability
import com.disciplineos.core.domain.blocker.BypassDenial
import com.disciplineos.core.model.BlockReason
import com.disciplineos.core.model.BypassReason
import com.disciplineos.core.model.PendingTaskSummary
import com.disciplineos.core.model.Priority
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Feedback after a bypass request (resolved to text in the UI). */
sealed interface BypassFeedback {
    data class Denied(val denial: BypassDenial, val retryAt: Instant?) : BypassFeedback
    data object Error : BypassFeedback
}

data class BlockScreenState(
    val reason: BlockReason,
    val pending: List<PendingTaskSummary>,
    val appLabel: String? = null,
    val availability: BypassAvailability? = null,
    val bypassDurationMinutes: Int = 10,
    val bypassBusy: Boolean = false,
    val bypassFeedback: BypassFeedback? = null,
    val motivationIndex: Int = 0,
    val now: Instant = Instant.now(),
    val zone: ZoneId = ZoneId.systemDefault(),
)

object BlockScreenTags {
    const val TASK_ITEM = "block_task_item"
    const val OPEN_TASKS = "block_open_tasks"
    const val GO_HOME = "block_go_home"
    const val EMERGENCY = "block_emergency"
    const val RECOVERY = "block_recovery"
    const val BYPASS_SHEET = "block_bypass_sheet"
}

private const val MAX_VISIBLE_TASKS = 5

/**
 * Premium, supportive block screen. Never traps the user: back = home, "home" is always available, emergency
 * release is always granted, and recovery mode is explained.
 */
@Composable
fun BlockScreen(
    state: BlockScreenState,
    onOpenTasks: () -> Unit,
    onGoHome: () -> Unit,
    onRequestBypass: (BypassReason, String) -> Unit,
    onOpenRecovery: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    var showSheet by rememberSaveable { mutableStateOf(false) }
    var showRecovery by rememberSaveable { mutableStateOf(false) }

    // Back never traps: it leaves to the home screen.
    BackHandler(onBack = onGoHome)

    val focus = state.reason == BlockReason.FOCUS_SESSION_ACTIVE
    val lines = stringArrayResource(R.array.block_motivation)
    val motivation = if (lines.isEmpty()) "" else lines[state.motivationIndex.mod(lines.size)]

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(listOf(colors.surfaceSunken, colors.background, colors.background)),
            ),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = spacing.screenGutter, vertical = spacing.xl),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(spacing.lg),
        ) {
            ShieldIllustration(modifier = Modifier.size(132.dp), focus = focus)

            Text(
                text = stringResource(if (focus) R.string.block_title_focus else R.string.block_title),
                style = DisciplineTheme.typography.headlineMedium,
                color = colors.textPrimary,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = when {
                    focus -> stringResource(R.string.block_subtitle_focus)
                    state.appLabel.isNullOrBlank() -> stringResource(R.string.block_subtitle_generic)
                    else -> stringResource(R.string.block_subtitle_app, state.appLabel.orEmpty())
                },
                style = DisciplineTheme.typography.bodyLarge,
                color = colors.textSecondary,
                textAlign = TextAlign.Center,
            )

            if (motivation.isNotBlank()) {
                Text(
                    text = motivation,
                    style = DisciplineTheme.typography.titleMedium,
                    color = colors.primarySoft,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = spacing.sm),
                )
            }

            if (state.pending.isNotEmpty()) {
                RemainingTasksCard(state.pending)
            }

            DsPrimaryButton(
                text = stringResource(R.string.block_open_tasks),
                onClick = onOpenTasks,
                icon = Icons.AutoMirrored.Filled.ListAlt,
                modifier = Modifier.fillMaxWidth().testTag(BlockScreenTags.OPEN_TASKS),
            )
            DsSecondaryButton(
                text = stringResource(R.string.block_go_home),
                onClick = onGoHome,
                icon = Icons.Filled.Home,
                modifier = Modifier.fillMaxWidth().testTag(BlockScreenTags.GO_HOME),
            )

            TextButton(
                onClick = { showSheet = true },
                modifier = Modifier.heightIn(min = spacing.minTouch).testTag(BlockScreenTags.EMERGENCY),
            ) {
                Text(
                    text = stringResource(R.string.block_emergency),
                    color = colors.danger,
                    style = DisciplineTheme.typography.titleMedium,
                )
            }

            Text(
                text = stringResource(R.string.block_recovery_link),
                style = DisciplineTheme.typography.labelLarge,
                color = colors.textMuted,
                modifier = Modifier
                    .heightIn(min = spacing.minTouch)
                    .clickable(role = Role.Button) { showRecovery = !showRecovery }
                    .padding(spacing.md)
                    .testTag(BlockScreenTags.RECOVERY),
            )
            AnimatedVisibility(visible = showRecovery) {
                DsCard(onClick = onOpenRecovery) {
                    Text(
                        text = stringResource(R.string.block_recovery_explain),
                        style = DisciplineTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                    )
                }
            }
            Spacer(Modifier.height(spacing.lg))
        }
    }

    if (showSheet) {
        BypassSheet(
            state = state,
            onDismiss = { showSheet = false },
            onConfirm = { reason, note -> onRequestBypass(reason, note) },
        )
    }
}

@Composable
private fun RemainingTasksCard(pending: List<PendingTaskSummary>) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    DsCard(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = stringResource(R.string.block_remaining_header),
            style = DisciplineTheme.typography.titleSmall,
            color = colors.textSecondary,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(spacing.sm))
        pending.take(MAX_VISIBLE_TASKS).forEach { task ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 40.dp)
                    .testTag(BlockScreenTags.TASK_ITEM),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(spacing.md),
            ) {
                Box(
                    Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(priorityColor(task.priority)),
                )
                Text(
                    text = task.title,
                    style = DisciplineTheme.typography.bodyLarge,
                    color = colors.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                if (task.overdue) {
                    DsBadge(text = stringResource(R.string.block_overdue), color = colors.danger)
                }
            }
        }
        val extra = pending.size - MAX_VISIBLE_TASKS
        if (extra > 0) {
            Text(
                text = stringResource(R.string.block_more_tasks, extra),
                style = DisciplineTheme.typography.bodyMedium,
                color = colors.textMuted,
            )
        }
    }
}

@Composable
private fun priorityColor(priority: Priority): Color {
    val colors = DisciplineTheme.colors
    return when (priority) {
        Priority.CRITICAL, Priority.HIGH -> colors.danger
        Priority.MEDIUM -> colors.mandatory
        Priority.LOW -> colors.textSecondary
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun BypassSheet(
    state: BlockScreenState,
    onDismiss: () -> Unit,
    onConfirm: (BypassReason, String) -> Unit,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var reason by rememberSaveable { mutableStateOf(BypassReason.EMERGENCY) }
    var note by rememberSaveable { mutableStateOf("") }
    val formatter = remember { DateTimeFormatter.ofPattern("HH:mm") }
    val availability = state.availability
    val nextAt = availability?.nextAllowedAt?.takeIf { it.isAfter(state.now) }
    val nonEmergencyAllowed = availability == null || (availability.remainingToday > 0 && nextAt == null)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.surface,
        modifier = Modifier.testTag(BlockScreenTags.BYPASS_SHEET),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = spacing.xl, vertical = spacing.md),
            verticalArrangement = Arrangement.spacedBy(spacing.md),
        ) {
            Text(
                text = stringResource(R.string.bypass_sheet_title),
                style = DisciplineTheme.typography.titleLarge,
                color = colors.textPrimary,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(R.string.bypass_sheet_body),
                style = DisciplineTheme.typography.bodyMedium,
                color = colors.textSecondary,
            )
            if (availability != null) {
                Text(
                    text = stringResource(R.string.bypass_remaining, availability.remainingToday),
                    style = DisciplineTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                )
                if (nextAt != null) {
                    Text(
                        text = stringResource(R.string.bypass_next_at, formatter.format(nextAt.atZone(state.zone))),
                        style = DisciplineTheme.typography.bodyMedium,
                        color = colors.warning,
                    )
                }
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(spacing.sm),
                verticalArrangement = Arrangement.spacedBy(spacing.sm),
            ) {
                BypassReason.entries.forEach { r ->
                    val enabled = r == BypassReason.EMERGENCY || nonEmergencyAllowed
                    DsChip(
                        label = reasonLabel(r),
                        selected = reason == r,
                        onClick = { if (enabled) reason = r },
                        modifier = Modifier
                            .alpha(if (enabled) 1f else 0.4f)
                            .semantics { if (!enabled) disabled() },
                    )
                }
            }
            if (reason == BypassReason.EMERGENCY) {
                Text(
                    text = stringResource(R.string.bypass_emergency_always),
                    style = DisciplineTheme.typography.bodySmall,
                    color = colors.success,
                )
            }
            DsTextField(
                value = note,
                onValueChange = { note = it },
                label = stringResource(R.string.bypass_note_label),
                singleLine = false,
                maxLength = 200,
            )
            state.bypassFeedback?.let { feedback ->
                Text(
                    text = feedbackText(feedback, state.zone),
                    style = DisciplineTheme.typography.bodyMedium,
                    color = colors.warning,
                )
            }
            val canConfirm = reason == BypassReason.EMERGENCY || nonEmergencyAllowed
            DsPrimaryButton(
                text = if (reason == BypassReason.EMERGENCY) {
                    stringResource(R.string.bypass_confirm_generic)
                } else {
                    stringResource(R.string.bypass_confirm, state.bypassDurationMinutes)
                },
                onClick = { onConfirm(reason, note.trim()) },
                enabled = canConfirm && !state.bypassBusy,
                loading = state.bypassBusy,
                modifier = Modifier.fillMaxWidth(),
            )
            DsSecondaryButton(
                text = stringResource(R.string.bypass_cancel),
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(spacing.sm))
        }
    }
}

@Composable
private fun reasonLabel(reason: BypassReason): String = stringResource(
    when (reason) {
        BypassReason.EMERGENCY -> R.string.bypass_reason_emergency
        BypassReason.WORK_OR_STUDY -> R.string.bypass_reason_work
        BypassReason.HEALTH -> R.string.bypass_reason_health
        BypassReason.OTHER -> R.string.bypass_reason_other
    },
)

@Composable
private fun feedbackText(feedback: BypassFeedback, zone: ZoneId): String = when (feedback) {
    BypassFeedback.Error -> stringResource(R.string.bypass_error)
    is BypassFeedback.Denied -> when (feedback.denial) {
        BypassDenial.DAILY_LIMIT_REACHED -> stringResource(R.string.bypass_denied_limit)
        BypassDenial.COOLDOWN -> stringResource(
            R.string.bypass_denied_cooldown,
            feedback.retryAt?.let { DateTimeFormatter.ofPattern("HH:mm").format(it.atZone(zone)) } ?: "",
        )
        BypassDenial.ALREADY_ACTIVE -> stringResource(R.string.bypass_denied_active)
        BypassDenial.BLOCKER_NOT_RESTRICTING -> stringResource(R.string.bypass_denied_not_restricting)
    }
}

/** Canvas-drawn shield with a soft glow and a gentle pulse (disabled with reduce-motion). */
@Composable
fun ShieldIllustration(modifier: Modifier = Modifier, focus: Boolean = false) {
    val colors = DisciplineTheme.colors
    val motion = DisciplineTheme.motion
    val accent = if (focus) colors.xp else colors.primary
    val pulse = if (motion.reduceMotion) {
        1f
    } else {
        val transition = rememberInfiniteTransition(label = "shield")
        val value by transition.animateFloat(
            initialValue = 0.97f,
            targetValue = 1.03f,
            animationSpec = infiniteRepeatable(tween(1600, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            label = "shieldPulse",
        )
        value
    }
    val description = stringResource(R.string.block_shield_cd)
    Canvas(
        modifier = modifier
            .scale(pulse)
            .semantics { contentDescription = description },
    ) {
        val w = size.width
        val h = size.height
        // Glow
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(accent.copy(alpha = 0.35f), Color.Transparent),
                center = Offset(w / 2f, h / 2f),
                radius = w * 0.62f,
            ),
            radius = w * 0.62f,
            center = Offset(w / 2f, h / 2f),
        )
        val shield = Path().apply {
            moveTo(w * 0.5f, h * 0.08f)
            lineTo(w * 0.84f, h * 0.22f)
            cubicTo(w * 0.84f, h * 0.55f, w * 0.72f, h * 0.80f, w * 0.5f, h * 0.93f)
            cubicTo(w * 0.28f, h * 0.80f, w * 0.16f, h * 0.55f, w * 0.16f, h * 0.22f)
            close()
        }
        drawPath(
            path = shield,
            brush = Brush.linearGradient(
                colors = listOf(accent, accent.copy(alpha = 0.55f)),
                start = Offset(w * 0.2f, 0f),
                end = Offset(w * 0.8f, h),
            ),
        )
        drawPath(
            path = shield,
            color = Color.White.copy(alpha = 0.25f),
            style = Stroke(width = w * 0.025f, join = StrokeJoin.Round),
        )
        // Check mark: "you can earn this"
        val check = Path().apply {
            moveTo(w * 0.35f, h * 0.50f)
            lineTo(w * 0.46f, h * 0.61f)
            lineTo(w * 0.67f, h * 0.39f)
        }
        drawPath(
            path = check,
            color = Color.White,
            style = Stroke(width = w * 0.065f, cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
    }
}
