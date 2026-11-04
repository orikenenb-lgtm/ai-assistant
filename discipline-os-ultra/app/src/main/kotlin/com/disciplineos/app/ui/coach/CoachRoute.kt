package com.disciplineos.app.ui.coach

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsBadge
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsConfirmDialog
import com.disciplineos.app.designsystem.component.DsEmptyState
import com.disciplineos.app.designsystem.component.DsErrorState
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.core.model.ActionStatus
import com.disciplineos.core.model.ChatMessage
import com.disciplineos.core.model.ChatRole
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.ProposedAction
import com.disciplineos.core.model.TaskKind
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Navigation entry point (see Routes.COACH). */
@Composable
fun CoachRoute(onBack: () -> Unit, viewModel: CoachViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    CoachScreen(
        state = state,
        onBack = onBack,
        onInputChange = viewModel::onInputChange,
        onSend = viewModel::send,
        onPrompt = viewModel::sendPrompt,
        onStop = viewModel::stopStreaming,
        onAccept = viewModel::acceptAction,
        onReject = viewModel::rejectAction,
        onClear = viewModel::clearHistory,
        onDismissError = viewModel::dismissError,
    )
}

@Composable
private fun CoachScreen(
    state: CoachUiState,
    onBack: () -> Unit,
    onInputChange: (String) -> Unit,
    onSend: () -> Unit,
    onPrompt: (String) -> Unit,
    onStop: () -> Unit,
    onAccept: (Long, Int) -> Unit,
    onReject: (Long, Int) -> Unit,
    onClear: () -> Unit,
    onDismissError: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val motion = DisciplineTheme.motion
    var confirmClear by rememberSaveable { mutableStateOf(false) }
    var showPrivacy by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val errorText = state.errorRes?.let { stringResource(it) }
    LaunchedEffect(errorText) {
        if (errorText != null) {
            snackbar.showSnackbar(errorText)
            onDismissError()
        }
    }

    val listState = rememberLazyListState()
    val itemCount = state.messages.size + (if (state.streamingText != null) 1 else 0)
    // Auto-scroll to the newest item on new messages and as streamed text grows.
    LaunchedEffect(itemCount, state.streamingText?.length) {
        if (itemCount > 0) {
            if (motion.reduceMotion) listState.scrollToItem(itemCount - 1) else listState.animateScrollToItem(itemCount - 1)
        }
    }

    Scaffold(
        containerColor = colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            DsTopBar(
                title = stringResource(R.string.feat_coach_title),
                onBack = onBack,
                actions = {
                    IconButton(
                        onClick = { confirmClear = true },
                        enabled = state.messages.isNotEmpty() && !state.sending,
                    ) {
                        Icon(Icons.Filled.DeleteSweep, contentDescription = stringResource(R.string.feat_coach_clear))
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .imePadding(),
        ) {
            ProviderHeader(state = state, onOpenPrivacy = { showPrivacy = true })
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.loading -> DsLoadingState(Modifier.fillMaxSize(), message = stringResource(R.string.feat_loading))
                    state.loadFailed -> DsErrorState(stringResource(R.string.feat_coach_error_load), Modifier.fillMaxSize())
                    state.messages.isEmpty() && state.streamingText == null -> DsEmptyState(
                        title = stringResource(R.string.feat_coach_empty_title),
                        message = stringResource(R.string.feat_coach_empty_message),
                        icon = Icons.Filled.Psychology,
                        modifier = Modifier.fillMaxSize(),
                    )
                    else -> LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = spacing.screenGutter, vertical = spacing.md),
                        verticalArrangement = Arrangement.spacedBy(spacing.sm),
                    ) {
                        items(state.messages, key = { it.id }) { message ->
                            MessageItem(
                                message = message,
                                pendingAction = state.pendingAction,
                                onAccept = onAccept,
                                onReject = onReject,
                            )
                        }
                        if (state.streamingText != null) {
                            item(key = "streaming") { StreamingBubble(state.streamingText) }
                        }
                    }
                }
            }
            if (state.limitReached) {
                LimitBanner()
            }
            QuickPrompts(enabled = !state.sending && !state.limitReached, onPrompt = onPrompt)
            Composer(state = state, onInputChange = onInputChange, onSend = onSend, onStop = onStop)
        }
    }

    if (confirmClear) {
        DsConfirmDialog(
            title = stringResource(R.string.feat_coach_clear_title),
            message = stringResource(R.string.feat_coach_clear_message),
            confirmLabel = stringResource(R.string.feat_coach_clear_confirm),
            dismissLabel = stringResource(R.string.feat_cancel),
            destructive = true,
            onConfirm = {
                confirmClear = false
                onClear()
            },
            onDismiss = { confirmClear = false },
        )
    }

    if (showPrivacy) {
        AlertDialog(
            onDismissRequest = { showPrivacy = false },
            confirmButton = {
                TextButton(onClick = { showPrivacy = false }) { Text(stringResource(R.string.feat_ok)) }
            },
            title = { Text(stringResource(R.string.feat_coach_privacy_title)) },
            text = {
                Text(
                    if (state.isLocalProvider) {
                        stringResource(R.string.feat_coach_privacy_local)
                    } else {
                        stringResource(
                            R.string.feat_coach_privacy_remote,
                            stringResource(if (state.privacy.shareTaskTitles) R.string.feat_yes else R.string.feat_no),
                            stringResource(if (state.privacy.shareAppUsage) R.string.feat_yes else R.string.feat_no),
                        )
                    },
                )
            },
            containerColor = colors.surface,
        )
    }
}

@Composable
private fun ProviderHeader(state: CoachUiState, onOpenPrivacy: () -> Unit) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val local = state.isLocalProvider
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surfaceSunken)
            .padding(horizontal = spacing.screenGutter, vertical = spacing.xs),
    ) {
        Icon(
            if (local) Icons.Filled.PhoneAndroid else Icons.Filled.Cloud,
            contentDescription = null,
            tint = if (local) colors.success else colors.primarySoft,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.size(spacing.sm))
        Column(Modifier.weight(1f)) {
            Text(
                stringResource(if (local) R.string.feat_coach_provider_local else R.string.feat_coach_provider_remote),
                style = MaterialTheme.typography.labelLarge,
                color = colors.textPrimary,
            )
            Text(
                stringResource(if (local) R.string.feat_coach_privacy_line_local else R.string.feat_coach_privacy_line_remote),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
        }
        TextButton(onClick = onOpenPrivacy, modifier = Modifier.height(48.dp)) {
            Icon(Icons.Filled.Info, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.size(spacing.xs))
            Text(stringResource(R.string.feat_coach_privacy_what))
        }
    }
}

@Composable
private fun MessageItem(
    message: ChatMessage,
    pendingAction: Pair<Long, Int>?,
    onAccept: (Long, Int) -> Unit,
    onReject: (Long, Int) -> Unit,
) {
    when (message.role) {
        ChatRole.NOTICE -> NoticeRow(message.text)
        ChatRole.USER -> Bubble(text = message.text, fromUser = true)
        ChatRole.ASSISTANT -> Column(verticalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.sm)) {
            if (message.text.isNotBlank()) Bubble(text = message.text, fromUser = false)
            message.actions.forEachIndexed { index, action ->
                ActionCard(
                    action = action,
                    busy = pendingAction == (message.id to index),
                    anyBusy = pendingAction != null,
                    onAccept = { onAccept(message.id, index) },
                    onReject = { onReject(message.id, index) },
                )
            }
        }
    }
}

/**
 * Chat bubble. User bubbles sit at the END edge (left in RTL, as in Hebrew messaging apps); coach bubbles at START.
 */
@Composable
private fun Bubble(text: String, fromUser: Boolean, trailing: (@Composable () -> Unit)? = null) {
    val colors = DisciplineTheme.colors
    val shape = if (fromUser) {
        RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = 18.dp, bottomEnd = 4.dp)
    } else {
        RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = 4.dp, bottomEnd = 18.dp)
    }
    val who = stringResource(if (fromUser) R.string.feat_coach_you else R.string.feat_coach_name)
    Box(
        Modifier.fillMaxWidth(),
        contentAlignment = if (fromUser) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Column(
            Modifier
                .widthIn(max = 320.dp)
                .clip(shape)
                .background(if (fromUser) colors.primary else colors.surfaceRaised)
                .padding(horizontal = 14.dp, vertical = 10.dp)
                .semantics(mergeDescendants = true) { contentDescription = "$who: $text" },
        ) {
            Text(text, style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
            trailing?.invoke()
        }
    }
}

@Composable
private fun StreamingBubble(text: String) {
    if (text.isEmpty()) {
        TypingIndicator()
    } else {
        Bubble(text = text, fromUser = false) {
            Spacer(Modifier.height(DisciplineTheme.spacing.xs))
            TypingDots()
        }
    }
}

@Composable
private fun TypingIndicator() {
    val colors = DisciplineTheme.colors
    val description = stringResource(R.string.feat_coach_typing)
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
        Box(
            Modifier
                .clip(RoundedCornerShape(18.dp))
                .background(colors.surfaceRaised)
                .padding(horizontal = 16.dp, vertical = 14.dp)
                .semantics {
                    contentDescription = description
                    liveRegion = LiveRegionMode.Polite
                },
        ) {
            TypingDots()
        }
    }
}

@Composable
private fun TypingDots() {
    val colors = DisciplineTheme.colors
    val reduceMotion = DisciplineTheme.motion.reduceMotion
    val transition = rememberInfiniteTransition(label = "typing")
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        repeat(3) { i ->
            val alpha = if (reduceMotion) {
                0.7f
            } else {
                val a by transition.animateFloat(
                    initialValue = 0.25f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(tween(durationMillis = 500, delayMillis = i * 150), RepeatMode.Reverse),
                    label = "dot$i",
                )
                a
            }
            Box(
                Modifier
                    .size(7.dp)
                    .alpha(alpha)
                    .clip(CircleShape)
                    .background(colors.textSecondary),
            )
        }
    }
}

@Composable
private fun NoticeRow(text: String) {
    val colors = DisciplineTheme.colors
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = colors.textSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .clip(RoundedCornerShape(12.dp))
                .background(colors.surfaceSunken)
                .padding(horizontal = 12.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun ActionCard(
    action: ProposedAction,
    busy: Boolean,
    anyBusy: Boolean,
    onAccept: () -> Unit,
    onReject: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val dateFormat = remember { DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM) }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(start = spacing.lg)
            .clip(RoundedCornerShape(DisciplineTheme.shapes.cardRadius))
            .background(colors.surface)
            .border(1.dp, colors.outline, RoundedCornerShape(DisciplineTheme.shapes.cardRadius))
            .padding(spacing.lg),
        verticalArrangement = Arrangement.spacedBy(spacing.sm),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.feat_coach_action_label),
                style = MaterialTheme.typography.labelLarge,
                color = colors.primarySoft,
                modifier = Modifier.weight(1f),
            )
            when (action.status) {
                ActionStatus.ACCEPTED -> DsBadge(stringResource(R.string.feat_coach_action_accepted), colors.success)
                ActionStatus.REJECTED -> DsBadge(stringResource(R.string.feat_coach_action_rejected), colors.textMuted)
                ActionStatus.INVALID -> DsBadge(stringResource(R.string.feat_coach_action_invalid), colors.danger)
                ActionStatus.PROPOSED -> Unit
            }
        }
        when (action) {
            is ProposedAction.CreateTask -> {
                val d = action.draft
                Text(d.title, style = MaterialTheme.typography.titleMedium, color = colors.textPrimary)
                val details = buildList {
                    add(stringResource(if (d.kind == TaskKind.MANDATORY) R.string.feat_coach_kind_mandatory else R.string.feat_coach_kind_optional))
                    add(stringResource(priorityLabel(d.priority)))
                    d.date?.let { add(it.format(dateFormat)) }
                    d.time?.let { add(it.toString()) }
                    d.estimatedMinutes?.let { add(stringResource(R.string.feat_minutes_value, it)) }
                }
                Text(details.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
                if (d.subTasks.isNotEmpty()) {
                    d.subTasks.forEach { sub ->
                        Text("• $sub", style = MaterialTheme.typography.bodyMedium, color = colors.textPrimary)
                    }
                }
            }
            is ProposedAction.RescheduleTask -> {
                Text(
                    stringResource(R.string.feat_coach_action_reschedule, action.newDate.format(dateFormat)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                )
            }
        }
        if (action.status == ActionStatus.PROPOSED) {
            Row(horizontalArrangement = Arrangement.spacedBy(spacing.sm), modifier = Modifier.fillMaxWidth()) {
                DsPrimaryButton(
                    text = stringResource(R.string.feat_coach_action_accept),
                    onClick = onAccept,
                    enabled = !anyBusy,
                    loading = busy,
                    modifier = Modifier.weight(1f),
                )
                DsSecondaryButton(
                    text = stringResource(R.string.feat_coach_action_reject),
                    onClick = onReject,
                    enabled = !anyBusy,
                    modifier = Modifier.weight(1f),
                )
            }
            Text(
                stringResource(R.string.feat_coach_action_note),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textMuted,
            )
        }
    }
}

private fun priorityLabel(p: Priority): Int = when (p) {
    Priority.LOW -> R.string.feat_priority_low
    Priority.MEDIUM -> R.string.feat_priority_medium
    Priority.HIGH -> R.string.feat_priority_high
    Priority.CRITICAL -> R.string.feat_priority_critical
}

@Composable
private fun LimitBanner() {
    val colors = DisciplineTheme.colors
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.warning.copy(alpha = 0.15f))
            .padding(horizontal = DisciplineTheme.spacing.screenGutter, vertical = DisciplineTheme.spacing.sm)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        Icon(Icons.Filled.Info, contentDescription = null, tint = colors.warning)
        Spacer(Modifier.size(DisciplineTheme.spacing.sm))
        Text(
            stringResource(R.string.feat_coach_limit_reached),
            style = MaterialTheme.typography.bodyMedium,
            color = colors.textPrimary,
        )
    }
}

@Composable
private fun QuickPrompts(enabled: Boolean, onPrompt: (String) -> Unit) {
    val prompts = listOf(
        stringResource(R.string.feat_coach_prompt_plan_day),
        stringResource(R.string.feat_coach_prompt_break_goal),
        stringResource(R.string.feat_coach_prompt_most_important),
        stringResource(R.string.feat_coach_prompt_week_summary),
    )
    Row(
        horizontalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.sm),
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = DisciplineTheme.spacing.screenGutter, vertical = DisciplineTheme.spacing.xs),
    ) {
        prompts.forEach { p ->
            DsChip(label = p, selected = false, onClick = { if (enabled) onPrompt(p) })
        }
    }
}

@Composable
private fun Composer(
    state: CoachUiState,
    onInputChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    Row(
        verticalAlignment = Alignment.Bottom,
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surface)
            .padding(horizontal = spacing.md, vertical = spacing.sm),
    ) {
        OutlinedTextField(
            value = state.input,
            onValueChange = onInputChange,
            enabled = !state.limitReached,
            placeholder = { Text(stringResource(R.string.feat_coach_input_hint)) },
            maxLines = 5,
            supportingText = if (CoachInput.showCounter(state.input.length)) {
                { Text(stringResource(R.string.feat_coach_counter, state.input.length, CoachInput.MAX_CHARS)) }
            } else {
                null
            },
            shape = RoundedCornerShape(DisciplineTheme.shapes.chipRadius),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = colors.primary,
                unfocusedBorderColor = colors.outline,
                focusedTextColor = colors.textPrimary,
                unfocusedTextColor = colors.textPrimary,
            ),
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.size(spacing.sm))
        if (state.sending) {
            IconButton(onClick = onStop, modifier = Modifier.size(56.dp)) {
                Icon(Icons.Filled.Stop, contentDescription = stringResource(R.string.feat_coach_stop), tint = colors.warning)
            }
        } else {
            IconButton(
                onClick = onSend,
                enabled = state.canSend,
                colors = IconButtonDefaults.iconButtonColors(
                    containerColor = colors.primary,
                    contentColor = colors.textPrimary,
                    disabledContainerColor = colors.surfaceSunken,
                    disabledContentColor = colors.textMuted,
                ),
                modifier = Modifier.size(56.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.feat_coach_send))
            }
        }
    }
}
