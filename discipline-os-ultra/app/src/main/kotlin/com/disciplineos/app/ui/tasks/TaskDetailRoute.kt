package com.disciplineos.app.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.FastForward
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.Snooze
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsBadge
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsConfirmDialog
import com.disciplineos.app.designsystem.component.DsDangerButton
import com.disciplineos.app.designsystem.component.DsEmptyState
import com.disciplineos.app.designsystem.component.DsErrorState
import com.disciplineos.app.designsystem.component.DsListRow
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.component.DsSectionHeader
import com.disciplineos.app.designsystem.component.DsTextField
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.ui.common.Formatters
import com.disciplineos.app.ui.common.currentLocale
import com.disciplineos.app.ui.common.formatMinutes
import com.disciplineos.app.ui.common.horizontalGutter
import com.disciplineos.app.ui.common.labelRes
import com.disciplineos.app.ui.common.recurrenceLabel
import com.disciplineos.app.ui.common.relativeDayLabel
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.RecurrenceRule
import com.disciplineos.core.model.TaskHistoryEntry
import com.disciplineos.core.model.TaskOccurrence
import com.disciplineos.core.model.VerificationMethod
import java.time.ZoneId

private enum class DetailDialog { NONE, NOTE, SNOOZE, SKIP, DELETE, ARCHIVE }

private val SnoozeOptions = listOf(10, 30, 60, 180)

/**
 * Task detail. `onOpenFocus` extends the Routes contract (`TaskDetailRoute(onEdit, onBack)`) with a
 * default, so the contract call still compiles.
 */
@Composable
fun TaskDetailRoute(
    onEdit: (Long) -> Unit,
    onBack: () -> Unit,
    onOpenFocus: () -> Unit = {},
    viewModel: TaskDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val back by rememberUpdatedState(onBack)
    val openFocus by rememberUpdatedState(onOpenFocus)
    val focusLabel = stringResource(R.string.core_detail_start_focus)
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                TaskDetailEvent.Closed -> back()
                TaskDetailEvent.OpenFocus -> openFocus()
                is TaskDetailEvent.Message -> {
                    val result = snackbarHostState.showSnackbar(
                        message = context.getString(event.text),
                        actionLabel = if (event.offerFocus) focusLabel else null,
                        withDismissAction = true,
                        duration = if (event.offerFocus) SnackbarDuration.Long else SnackbarDuration.Short,
                    )
                    if (result == SnackbarResult.ActionPerformed && event.offerFocus) viewModel.startFocus()
                }
            }
        }
    }

    var dialog by rememberSaveable { mutableStateOf(DetailDialog.NONE) }
    var menuOpen by remember { mutableStateOf(false) }
    val colors = DisciplineTheme.colors
    val task = state.task

    Scaffold(
        containerColor = colors.background,
        topBar = {
            DsTopBar(
                title = stringResource(R.string.core_detail_title),
                onBack = onBack,
                actions = {
                    if (task != null) {
                        IconButton(onClick = { onEdit(task.id) }) {
                            Icon(Icons.Outlined.Edit, contentDescription = stringResource(R.string.core_action_edit), tint = colors.textPrimary)
                        }
                        Box {
                            IconButton(onClick = { menuOpen = true }) {
                                Icon(Icons.Outlined.MoreVert, contentDescription = stringResource(R.string.core_cd_more), tint = colors.textPrimary)
                            }
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.core_action_archive)) },
                                    leadingIcon = { Icon(Icons.Outlined.Archive, contentDescription = null) },
                                    onClick = {
                                        menuOpen = false
                                        dialog = DetailDialog.ARCHIVE
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.core_action_delete), color = colors.danger) },
                                    leadingIcon = { Icon(Icons.Outlined.DeleteOutline, contentDescription = null, tint = colors.danger) },
                                    onClick = {
                                        menuOpen = false
                                        dialog = DetailDialog.DELETE
                                    },
                                )
                            }
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { inner ->
        when {
            state.loading -> DsLoadingState(modifier = Modifier.padding(inner))
            state.error -> DsErrorState(message = stringResource(R.string.core_detail_error), modifier = Modifier.padding(inner))
            state.notFound || task == null -> DsEmptyState(
                title = stringResource(R.string.core_task_not_found_title),
                message = stringResource(R.string.core_task_not_found_message),
                icon = Icons.Outlined.SearchOff,
                actionLabel = stringResource(R.string.core_action_back),
                onAction = onBack,
                modifier = Modifier.padding(inner),
            )
            else -> BoxWithConstraints(Modifier.fillMaxSize().padding(inner)) {
                val gutter = horizontalGutter(maxWidth)
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = gutter, end = gutter, top = 8.dp, bottom = 32.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item(key = "header") { HeaderCard(state) }
                    if (state.occurrences.size > 1) {
                        item(key = "occurrences") { OccurrencePicker(state, onSelect = viewModel::select) }
                    }
                    item(key = "status") {
                        StatusCard(
                            state = state,
                            onComplete = {
                                if (task.verification == VerificationMethod.REFLECTION_NOTE) dialog = DetailDialog.NOTE else viewModel.complete()
                            },
                            onUncomplete = viewModel::uncomplete,
                            onSnooze = { dialog = DetailDialog.SNOOZE },
                            onSkip = { dialog = DetailDialog.SKIP },
                            onFocus = viewModel::startFocus,
                        )
                    }
                    if (state.subTasks.isNotEmpty()) {
                        item(key = "subtasks-header") {
                            DsSectionHeader(
                                title = stringResource(
                                    R.string.core_detail_subtasks_header,
                                    state.subTasks.count { it.done },
                                    state.subTasks.size,
                                ),
                            )
                        }
                        items(state.subTasks, key = { "sub-${it.id}" }) { sub ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 48.dp)
                                    .clip(DisciplineTheme.shapes.chipRadius.let { androidx.compose.foundation.shape.RoundedCornerShape(it) })
                                    .toggleable(value = sub.done, role = Role.Checkbox, onValueChange = { viewModel.toggleSubTask(sub.id, it) }),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(
                                    checked = sub.done,
                                    onCheckedChange = null,
                                    colors = CheckboxDefaults.colors(checkedColor = colors.success, uncheckedColor = colors.outline, checkmarkColor = colors.background),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = sub.title,
                                    style = DisciplineTheme.typography.bodyLarge,
                                    color = if (sub.done) colors.textMuted else colors.textPrimary,
                                    textDecoration = if (sub.done) TextDecoration.LineThrough else null,
                                )
                            }
                        }
                    }
                    if (state.history.isNotEmpty()) {
                        item(key = "history-header") { DsSectionHeader(title = stringResource(R.string.core_detail_history)) }
                        val last = state.history.lastIndex
                        items(state.history.size, key = { "h-${state.history[it].id}-$it" }) { index ->
                            HistoryRow(entry = state.history[index], isLast = index == last)
                        }
                    }
                    item(key = "danger") {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 12.dp)) {
                            DsSecondaryButton(
                                text = stringResource(R.string.core_action_archive),
                                onClick = { dialog = DetailDialog.ARCHIVE },
                                icon = Icons.Outlined.Archive,
                                enabled = !state.busy,
                                modifier = Modifier.weight(1f),
                            )
                            DsDangerButton(
                                text = stringResource(R.string.core_action_delete),
                                onClick = { dialog = DetailDialog.DELETE },
                                enabled = !state.busy,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }
        }
    }

    when (dialog) {
        DetailDialog.NONE -> Unit
        DetailDialog.NOTE -> ReflectionNoteDialog(
            onConfirm = { note ->
                dialog = DetailDialog.NONE
                viewModel.complete(note)
            },
            onDismiss = { dialog = DetailDialog.NONE },
        )
        DetailDialog.SNOOZE -> SnoozeDialog(
            onPick = { minutes ->
                dialog = DetailDialog.NONE
                viewModel.snooze(minutes)
            },
            onDismiss = { dialog = DetailDialog.NONE },
        )
        DetailDialog.SKIP -> SkipDialog(
            onConfirm = { reason ->
                dialog = DetailDialog.NONE
                viewModel.skip(reason)
            },
            onDismiss = { dialog = DetailDialog.NONE },
        )
        DetailDialog.DELETE -> DsConfirmDialog(
            title = stringResource(R.string.core_detail_delete_title),
            message = stringResource(R.string.core_detail_delete_message),
            confirmLabel = stringResource(R.string.core_action_delete),
            dismissLabel = stringResource(R.string.core_cancel),
            onConfirm = {
                dialog = DetailDialog.NONE
                viewModel.delete()
            },
            onDismiss = { dialog = DetailDialog.NONE },
            destructive = true,
        )
        DetailDialog.ARCHIVE -> DsConfirmDialog(
            title = stringResource(R.string.core_detail_archive_title),
            message = stringResource(R.string.core_detail_archive_message),
            confirmLabel = stringResource(R.string.core_action_archive),
            dismissLabel = stringResource(R.string.core_cancel),
            onConfirm = {
                dialog = DetailDialog.NONE
                viewModel.archive()
            },
            onDismiss = { dialog = DetailDialog.NONE },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HeaderCard(state: TaskDetailUiState) {
    val task = state.task ?: return
    val colors = DisciplineTheme.colors
    DsCard(modifier = Modifier.fillMaxWidth()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            DsBadge(text = stringResource(task.kind.labelRes()), color = colors.kindColor(task.kind))
            if (task.priority != Priority.MEDIUM) {
                DsBadge(text = stringResource(task.priority.labelRes()), color = colors.priorityColor(task.priority))
            }
            state.categoryName?.let { DsBadge(text = it, color = colors.primarySoft) }
            if (task.archived) DsBadge(text = stringResource(R.string.core_archived), color = colors.textSecondary)
        }
        Spacer(Modifier.height(10.dp))
        Text(text = task.title, style = DisciplineTheme.typography.headlineSmall, color = colors.textPrimary)
        if (task.notes.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(text = task.notes, style = DisciplineTheme.typography.bodyMedium, color = colors.textSecondary)
        }
        Spacer(Modifier.height(8.dp))
        val schedule = buildList {
            add(if (task.recurrence == RecurrenceRule.None) Formatters.fullDate(task.startDate, currentLocale()) else recurrenceLabel(task.recurrence))
            task.dueTime?.let { add(Formatters.time(it)) }
        }.joinToString(" · ")
        DsListRow(title = stringResource(R.string.core_detail_schedule), subtitle = schedule, leadingIcon = Icons.Outlined.Event)
        task.estimatedMinutes?.let {
            DsListRow(title = stringResource(R.string.core_editor_estimate), subtitle = formatMinutes(it), leadingIcon = Icons.Outlined.HourglassEmpty)
        }
        if (task.verification != VerificationMethod.NONE) {
            DsListRow(title = stringResource(R.string.core_editor_section_verification), subtitle = stringResource(task.verification.labelRes()), leadingIcon = Icons.Outlined.Verified)
        }
        if (state.dependencyTitles.isNotEmpty()) {
            DsListRow(
                title = stringResource(R.string.core_editor_section_dependencies),
                subtitle = state.dependencyTitles.joinToString(", "),
                leadingIcon = Icons.Outlined.Link,
            )
        }
    }
}

@Composable
private fun OccurrencePicker(state: TaskDetailUiState, onSelect: (Long) -> Unit) {
    val visible = state.occurrences.filter {
        !it.localDate.isBefore(state.today.minusDays(7)) && !it.localDate.isAfter(state.today.plusDays(14))
    }.ifEmpty { state.occurrences.takeLast(10) }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(visible, key = { it.id }) { occ ->
            DsChip(
                label = relativeDayLabel(occ.localDate, state.today),
                selected = occ.id == state.selected?.id,
                onClick = { onSelect(occ.id) },
                leadingIcon = if (occ.status == OccurrenceStatus.COMPLETED) Icons.Filled.Check else null,
            )
        }
    }
}

@Composable
private fun StatusCard(
    state: TaskDetailUiState,
    onComplete: () -> Unit,
    onUncomplete: () -> Unit,
    onSnooze: () -> Unit,
    onSkip: () -> Unit,
    onFocus: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    val task = state.task ?: return
    val occ: TaskOccurrence? = state.selected
    val zone = remember(task.zoneId) { runCatching { ZoneId.of(task.zoneId) }.getOrDefault(ZoneId.systemDefault()) }
    DsCard(modifier = Modifier.fillMaxWidth()) {
        if (occ == null) {
            Text(text = stringResource(R.string.core_detail_no_occurrence), style = DisciplineTheme.typography.bodyMedium, color = colors.textSecondary)
            return@DsCard
        }
        val statusColor = when (occ.status) {
            OccurrenceStatus.PENDING -> if (occ.localDate.isBefore(state.today) || occ.dueAt?.isBefore(state.now) == true) colors.danger else colors.kindColor(task.kind)
            OccurrenceStatus.COMPLETED -> colors.success
            OccurrenceStatus.SKIPPED, OccurrenceStatus.MISSED -> colors.textSecondary
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = relativeDayLabel(occ.localDate, state.today), style = DisciplineTheme.typography.titleMedium, color = colors.textPrimary)
                val dueText = occ.dueAt?.let { stringResource(R.string.core_detail_due_at, Formatters.dateTime(it, zone, currentLocale())) }
                if (dueText != null) Text(text = dueText, style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
            }
            DsBadge(text = stringResource(occ.status.labelRes()), color = statusColor)
        }
        val snoozed = occ.snoozedUntil
        if (occ.status == OccurrenceStatus.PENDING && snoozed != null && snoozed.isAfter(state.now)) {
            Text(
                text = stringResource(R.string.core_snoozed_until, Formatters.time(snoozed, zone)),
                style = DisciplineTheme.typography.bodySmall,
                color = colors.warning,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        occ.verificationNote?.takeIf { it.isNotBlank() }?.let { note ->
            Spacer(Modifier.height(8.dp))
            Text(text = stringResource(R.string.core_detail_reflection, note), style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
        }
        Spacer(Modifier.height(14.dp))
        when (occ.status) {
            OccurrenceStatus.PENDING -> {
                DsPrimaryButton(
                    text = stringResource(R.string.core_detail_complete),
                    onClick = onComplete,
                    loading = state.busy,
                    icon = Icons.Filled.Check,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (task.verification != VerificationMethod.NONE) {
                    Text(
                        text = stringResource(task.verification.descriptionResShort()),
                        style = DisciplineTheme.typography.bodySmall,
                        color = colors.textMuted,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    DsSecondaryButton(
                        text = stringResource(R.string.core_detail_snooze),
                        onClick = onSnooze,
                        icon = Icons.Outlined.Snooze,
                        enabled = !state.busy,
                        modifier = Modifier.weight(1f),
                    )
                    DsSecondaryButton(
                        text = stringResource(R.string.core_detail_skip),
                        onClick = onSkip,
                        icon = Icons.Outlined.FastForward,
                        enabled = !state.busy,
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(10.dp))
                DsSecondaryButton(
                    text = stringResource(R.string.core_detail_start_focus),
                    onClick = onFocus,
                    icon = if (task.verification == VerificationMethod.FOCUS_TIMER) Icons.Outlined.Timer else Icons.Filled.PlayArrow,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            OccurrenceStatus.COMPLETED -> DsSecondaryButton(
                text = stringResource(R.string.core_detail_uncomplete),
                onClick = onUncomplete,
                icon = Icons.Outlined.Replay,
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
            )
            OccurrenceStatus.SKIPPED, OccurrenceStatus.MISSED -> Text(
                text = stringResource(R.string.core_detail_resolved_note),
                style = DisciplineTheme.typography.bodySmall,
                color = colors.textMuted,
            )
        }
    }
}

private fun VerificationMethod.descriptionResShort(): Int = when (this) {
    VerificationMethod.NONE -> R.string.core_verify_none_desc
    VerificationMethod.CHECKLIST -> R.string.core_verify_required_checklist
    VerificationMethod.FOCUS_TIMER -> R.string.core_verify_required_focus
    VerificationMethod.REFLECTION_NOTE -> R.string.core_verify_required_note
}

@Composable
private fun HistoryRow(entry: TaskHistoryEntry, isLast: Boolean) {
    val colors = DisciplineTheme.colors
    val zone = remember { ZoneId.systemDefault() }
    val icon = when (entry.type) {
        com.disciplineos.core.model.TaskHistoryType.COMPLETED -> Icons.Filled.Check
        com.disciplineos.core.model.TaskHistoryType.SNOOZED -> Icons.Outlined.Snooze
        com.disciplineos.core.model.TaskHistoryType.SKIPPED -> Icons.Outlined.FastForward
        com.disciplineos.core.model.TaskHistoryType.EDITED -> Icons.Outlined.Edit
        com.disciplineos.core.model.TaskHistoryType.ARCHIVED -> Icons.Outlined.Archive
        else -> Icons.Outlined.Checklist
    }
    val tint = when (entry.type) {
        com.disciplineos.core.model.TaskHistoryType.COMPLETED -> colors.success
        com.disciplineos.core.model.TaskHistoryType.MISSED, com.disciplineos.core.model.TaskHistoryType.DELETED -> colors.danger
        com.disciplineos.core.model.TaskHistoryType.SNOOZED, com.disciplineos.core.model.TaskHistoryType.SKIPPED -> colors.warning
        else -> colors.primarySoft
    }
    Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min).semantics(mergeDescendants = true) {}) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(32.dp).fillMaxHeight()) {
            Box(
                modifier = Modifier.size(28.dp).clip(CircleShape).background(tint.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
            }
            if (!isLast) {
                Box(Modifier.width(2.dp).weight(1f).background(colors.outline.copy(alpha = 0.6f)))
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f).padding(bottom = 14.dp)) {
            Text(text = stringResource(entry.type.labelRes()), style = DisciplineTheme.typography.bodyMedium, color = colors.textPrimary)
            Text(
                text = Formatters.dateTime(entry.at, zone, currentLocale()),
                style = DisciplineTheme.typography.bodySmall,
                color = colors.textMuted,
            )
            if (entry.detail.isNotBlank()) {
                Text(text = entry.detail, style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
            }
        }
    }
}

@Composable
private fun ReflectionNoteDialog(onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var note by rememberSaveable { mutableStateOf("") }
    val valid = note.trim().length >= MIN_NOTE_CHARS
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.core_detail_note_title)) },
        text = {
            Column {
                Text(stringResource(R.string.core_detail_note_message), style = DisciplineTheme.typography.bodyMedium, color = DisciplineTheme.colors.textSecondary)
                Spacer(Modifier.height(10.dp))
                DsTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = stringResource(R.string.core_detail_note_label),
                    singleLine = false,
                    maxLength = 500,
                    supportingText = stringResource(R.string.core_detail_note_min, MIN_NOTE_CHARS),
                )
            }
        },
        confirmButton = { TextButton(enabled = valid, onClick = { onConfirm(note) }) { Text(stringResource(R.string.core_detail_complete)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.core_cancel)) } },
        containerColor = DisciplineTheme.colors.surface,
    )
}

@Composable
private fun SnoozeDialog(onPick: (Int) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.core_detail_snooze_title)) },
        text = {
            Column {
                SnoozeOptions.forEach { minutes ->
                    DsListRow(
                        title = stringResource(R.string.core_detail_snooze_for, formatMinutes(minutes)),
                        leadingIcon = Icons.Outlined.Snooze,
                        onClick = { onPick(minutes) },
                    )
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.core_cancel)) } },
        containerColor = DisciplineTheme.colors.surface,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SkipDialog(onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var reason by rememberSaveable { mutableStateOf("") }
    val quickReasons = listOf(
        stringResource(R.string.core_skip_reason_sick),
        stringResource(R.string.core_skip_reason_not_relevant),
        stringResource(R.string.core_skip_reason_rescheduled),
    )
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.core_detail_skip_title)) },
        text = {
            Column {
                Text(stringResource(R.string.core_detail_skip_message), style = DisciplineTheme.typography.bodyMedium, color = DisciplineTheme.colors.textSecondary)
                Spacer(Modifier.height(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    quickReasons.forEach { r -> DsChip(label = r, selected = reason == r, onClick = { reason = r }) }
                }
                DsTextField(value = reason, onValueChange = { reason = it }, label = stringResource(R.string.core_detail_skip_label), maxLength = 200)
            }
        },
        confirmButton = { TextButton(enabled = reason.isNotBlank(), onClick = { onConfirm(reason) }) { Text(stringResource(R.string.core_detail_skip)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.core_cancel)) } },
        containerColor = DisciplineTheme.colors.surface,
    )
}

private const val MIN_NOTE_CHARS = 10
