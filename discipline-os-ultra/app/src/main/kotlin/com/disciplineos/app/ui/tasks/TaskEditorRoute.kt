package com.disciplineos.app.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsEmptyState
import com.disciplineos.app.designsystem.component.DsListRow
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.component.DsTextField
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.ui.common.ContentMaxWidth
import com.disciplineos.app.ui.common.Formatters
import com.disciplineos.app.ui.common.currentLocale
import com.disciplineos.app.ui.common.descriptionRes
import com.disciplineos.app.ui.common.formatMinutes
import com.disciplineos.app.ui.common.horizontalGutter
import com.disciplineos.app.ui.common.labelRes
import com.disciplineos.app.ui.common.orderedWeek
import com.disciplineos.app.ui.common.parseHexColor
import com.disciplineos.app.ui.common.toHex
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.VerificationMethod
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime

private const val DAY_MILLIS = 86_400_000L

private enum class EditorDialog { NONE, START_DATE, END_DATE, TIME, DEPENDENCIES, NEW_CATEGORY }

@Composable
fun TaskEditorRoute(
    onDone: () -> Unit,
    viewModel: TaskEditorViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val done by rememberUpdatedState(onDone)
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                TaskEditorEvent.Saved -> done()
                is TaskEditorEvent.Message -> snackbarHostState.showSnackbar(context.getString(event.text), withDismissAction = true)
            }
        }
    }
    TaskEditorScreen(
        state = state,
        snackbarHostState = snackbarHostState,
        onBack = onDone,
        onUpdate = viewModel::update,
        onSave = viewModel::save,
        onCreateCategory = viewModel::createCategory,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TaskEditorScreen(
    state: TaskEditorUiState,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
    onUpdate: ((EditorForm) -> EditorForm) -> Unit,
    onSave: () -> Unit,
    onCreateCategory: (String, String) -> Unit,
) {
    val colors = DisciplineTheme.colors
    var dialog by rememberSaveable { mutableStateOf(EditorDialog.NONE) }
    val form = state.form

    Scaffold(
        containerColor = colors.background,
        topBar = {
            DsTopBar(
                title = stringResource(if (state.isNew) R.string.core_editor_new_title else R.string.core_editor_edit_title),
                onBack = onBack,
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        bottomBar = {
            if (!state.loading && !state.notFound) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.background)
                        .windowInsetsPadding(WindowInsets.navigationBars)
                        .imePadding()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    DsPrimaryButton(
                        text = stringResource(R.string.core_save),
                        onClick = onSave,
                        loading = state.saving,
                        icon = Icons.Filled.Check,
                        modifier = Modifier
                            .fillMaxWidth()
                            .then(Modifier.width(ContentMaxWidth)),
                    )
                }
            }
        },
    ) { inner ->
        when {
            state.loading -> DsLoadingState(modifier = Modifier.padding(inner))
            state.notFound -> DsEmptyState(
                title = stringResource(R.string.core_task_not_found_title),
                message = stringResource(R.string.core_task_not_found_message),
                icon = Icons.Outlined.SearchOff,
                actionLabel = stringResource(R.string.core_action_back),
                onAction = onBack,
                modifier = Modifier.padding(inner),
            )
            else -> BoxWithConstraints(Modifier.fillMaxSize().padding(inner)) {
                val gutter = horizontalGutter(maxWidth)
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = gutter, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    BasicsCard(state, onUpdate)
                    KindCard(form.kind) { kind -> onUpdate { it.copy(kind = kind) } }
                    PriorityCategoryCard(state, onUpdate, onNewCategory = { dialog = EditorDialog.NEW_CATEGORY })
                    ScheduleCard(
                        state = state,
                        onUpdate = onUpdate,
                        onPickStart = { dialog = EditorDialog.START_DATE },
                        onPickEnd = { dialog = EditorDialog.END_DATE },
                        onPickTime = { dialog = EditorDialog.TIME },
                    )
                    RemindersEstimateCard(state, onUpdate)
                    VerificationCard(form.verification) { v -> onUpdate { it.copy(verification = v) } }
                    DependenciesCard(state, onEdit = { dialog = EditorDialog.DEPENDENCIES }, onRemove = { id -> onUpdate { it.copy(dependsOn = it.dependsOn - id) } })
                    SubTasksCard(state, onUpdate)
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }

    when (dialog) {
        EditorDialog.NONE -> Unit
        EditorDialog.START_DATE -> DatePickerModal(
            initial = form.startDate,
            minDate = null,
            onPick = { date ->
                onUpdate { f ->
                    val weekly = if (f.weeklyDays == setOf(f.startDate.dayOfWeek)) setOf(date.dayOfWeek) else f.weeklyDays
                    f.copy(startDate = date, weeklyDays = weekly)
                }
            },
            onDismiss = { dialog = EditorDialog.NONE },
        )
        EditorDialog.END_DATE -> DatePickerModal(
            initial = form.endDate ?: form.startDate.plusMonths(1),
            minDate = form.startDate,
            onPick = { date -> onUpdate { it.copy(endDate = date) } },
            onDismiss = { dialog = EditorDialog.NONE },
        )
        EditorDialog.TIME -> TimePickerModal(
            initial = form.dueTime ?: LocalTime.of(9, 0),
            onPick = { time -> onUpdate { it.copy(dueTime = time) } },
            onDismiss = { dialog = EditorDialog.NONE },
        )
        EditorDialog.DEPENDENCIES -> DependenciesDialog(
            state = state,
            onConfirm = { ids -> onUpdate { it.copy(dependsOn = ids) } },
            onDismiss = { dialog = EditorDialog.NONE },
        )
        EditorDialog.NEW_CATEGORY -> NewCategoryDialog(
            onCreate = { name, hex -> onCreateCategory(name, hex) },
            onDismiss = { dialog = EditorDialog.NONE },
        )
    }
}

// ----------------------------------------------------------------------------------------------
// Sections
// ----------------------------------------------------------------------------------------------

@Composable
private fun EditorSection(title: String, content: @Composable () -> Unit) {
    DsCard(modifier = Modifier.fillMaxWidth()) {
        Text(text = title, style = DisciplineTheme.typography.titleMedium, color = DisciplineTheme.colors.textPrimary)
        Spacer(Modifier.height(10.dp))
        content()
    }
}

@Composable
private fun FieldError(messageRes: Int?) {
    if (messageRes != null) {
        Text(
            text = stringResource(messageRes),
            style = DisciplineTheme.typography.bodySmall,
            color = DisciplineTheme.colors.danger,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

@Composable
private fun BasicsCard(state: TaskEditorUiState, onUpdate: ((EditorForm) -> EditorForm) -> Unit) {
    val form = state.form
    EditorSection(stringResource(R.string.core_editor_section_basics)) {
        val titleError = state.fieldErrors[EditorField.TITLE]
        DsTextField(
            value = form.title,
            onValueChange = { v -> onUpdate { it.copy(title = v) } },
            label = stringResource(R.string.core_editor_title_label),
            maxLength = TaskEditorViewModel.TITLE_MAX,
            isError = titleError != null,
            supportingText = titleError?.let { stringResource(it) },
        )
        Spacer(Modifier.height(8.dp))
        val notesError = state.fieldErrors[EditorField.NOTES]
        DsTextField(
            value = form.notes,
            onValueChange = { v -> onUpdate { it.copy(notes = v) } },
            label = stringResource(R.string.core_editor_notes_label),
            singleLine = false,
            maxLength = TaskEditorViewModel.NOTES_MAX,
            isError = notesError != null,
            supportingText = notesError?.let { stringResource(it) },
        )
    }
}

@Composable
private fun KindCard(kind: TaskKind, onSelect: (TaskKind) -> Unit) {
    val colors = DisciplineTheme.colors
    EditorSection(stringResource(R.string.core_editor_section_kind)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            KindOption(
                title = stringResource(R.string.core_kind_mandatory),
                subtitle = stringResource(R.string.core_editor_kind_mandatory_short),
                selected = kind == TaskKind.MANDATORY,
                accent = colors.mandatory,
                onClick = { onSelect(TaskKind.MANDATORY) },
                modifier = Modifier.weight(1f),
            )
            KindOption(
                title = stringResource(R.string.core_kind_optional),
                subtitle = stringResource(R.string.core_editor_kind_optional_short),
                selected = kind == TaskKind.OPTIONAL,
                accent = colors.optional,
                onClick = { onSelect(TaskKind.OPTIONAL) },
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.Lightbulb, contentDescription = null, tint = if (kind == TaskKind.MANDATORY) colors.mandatory else colors.optional, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                text = stringResource(if (kind == TaskKind.MANDATORY) R.string.core_editor_kind_mandatory_explain else R.string.core_editor_kind_optional_explain),
                style = DisciplineTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
        }
    }
}

@Composable
private fun KindOption(title: String, subtitle: String, selected: Boolean, accent: Color, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = DisciplineTheme.colors
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = modifier
            .heightIn(min = 72.dp)
            .clip(shape)
            .background(if (selected) accent.copy(alpha = 0.16f) else colors.surfaceSunken)
            .border(if (selected) 2.dp else 1.dp, if (selected) accent else colors.outline, shape)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Flag, contentDescription = null, tint = accent, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(text = title, style = DisciplineTheme.typography.titleMedium, color = colors.textPrimary)
        }
        Text(text = subtitle, style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PriorityCategoryCard(state: TaskEditorUiState, onUpdate: ((EditorForm) -> EditorForm) -> Unit, onNewCategory: () -> Unit) {
    val form = state.form
    EditorSection(stringResource(R.string.core_editor_section_priority)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Priority.entries.forEach { p ->
                DsChip(label = stringResource(p.labelRes()), selected = form.priority == p, onClick = { onUpdate { it.copy(priority = p) } })
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(text = stringResource(R.string.core_editor_category), style = DisciplineTheme.typography.labelLarge, color = DisciplineTheme.colors.textSecondary)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DsChip(label = stringResource(R.string.core_editor_no_category), selected = form.categoryId == null, onClick = { onUpdate { it.copy(categoryId = null) } })
            state.categories.forEach { category ->
                DsChip(
                    label = category.name,
                    selected = form.categoryId == category.id,
                    onClick = { onUpdate { it.copy(categoryId = category.id) } },
                )
            }
            DsChip(label = stringResource(R.string.core_editor_new_category), selected = false, onClick = onNewCategory, leadingIcon = Icons.Filled.Add)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ScheduleCard(
    state: TaskEditorUiState,
    onUpdate: ((EditorForm) -> EditorForm) -> Unit,
    onPickStart: () -> Unit,
    onPickEnd: () -> Unit,
    onPickTime: () -> Unit,
) {
    val form = state.form
    val locale = currentLocale()
    val colors = DisciplineTheme.colors
    EditorSection(stringResource(R.string.core_editor_section_schedule)) {
        DsListRow(
            title = stringResource(if (form.recurrenceType == RecurrenceType.NONE) R.string.core_editor_date else R.string.core_editor_start_date),
            subtitle = Formatters.fullDate(form.startDate, locale),
            leadingIcon = Icons.Outlined.Event,
            onClick = onPickStart,
        )
        DsListRow(
            title = stringResource(R.string.core_editor_time),
            subtitle = form.dueTime?.let { Formatters.time(it) } ?: stringResource(R.string.core_editor_any_time),
            leadingIcon = Icons.Outlined.Schedule,
            onClick = onPickTime,
            trailing = if (form.dueTime != null) {
                {
                    IconButton(onClick = { onUpdate { it.copy(dueTime = null) } }) {
                        Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.core_cd_clear_time), tint = colors.textSecondary)
                    }
                }
            } else {
                null
            },
        )
        Spacer(Modifier.height(8.dp))
        Text(text = stringResource(R.string.core_editor_recurrence), style = DisciplineTheme.typography.labelLarge, color = colors.textSecondary)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RecurrenceType.entries.forEach { type ->
                DsChip(
                    label = stringResource(type.labelRes()),
                    selected = form.recurrenceType == type,
                    onClick = { onUpdate { it.copy(recurrenceType = type) } },
                )
            }
        }
        if (form.recurrenceType == RecurrenceType.WEEKLY) {
            Spacer(Modifier.height(6.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                orderedWeek(DayOfWeek.SUNDAY).forEach { day ->
                    DsChip(
                        label = Formatters.shortDay(day, locale),
                        selected = day in form.weeklyDays,
                        onClick = {
                            onUpdate { f -> f.copy(weeklyDays = if (day in f.weeklyDays) f.weeklyDays - day else f.weeklyDays + day) }
                        },
                    )
                }
            }
            FieldError(state.fieldErrors[EditorField.RECURRENCE])
        }
        if (form.recurrenceType == RecurrenceType.MONTHLY) {
            Text(
                text = stringResource(R.string.core_recurrence_monthly_day, form.startDate.dayOfMonth),
                style = DisciplineTheme.typography.bodySmall,
                color = colors.textSecondary,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (form.recurrenceType != RecurrenceType.NONE) {
            Spacer(Modifier.height(4.dp))
            DsListRow(
                title = stringResource(R.string.core_editor_end_date),
                subtitle = form.endDate?.let { Formatters.fullDate(it, locale) } ?: stringResource(R.string.core_editor_no_end),
                leadingIcon = Icons.Outlined.EventBusy,
                onClick = onPickEnd,
                trailing = if (form.endDate != null) {
                    {
                        IconButton(onClick = { onUpdate { it.copy(endDate = null) } }) {
                            Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.core_cd_clear_end_date), tint = colors.textSecondary)
                        }
                    }
                } else {
                    null
                },
            )
        }
        FieldError(state.fieldErrors[EditorField.DATES])
    }
}

private fun RecurrenceType.labelRes(): Int = when (this) {
    RecurrenceType.NONE -> R.string.core_recurrence_none
    RecurrenceType.DAILY -> R.string.core_recurrence_daily
    RecurrenceType.WEEKLY -> R.string.core_recurrence_weekly
    RecurrenceType.MONTHLY -> R.string.core_recurrence_monthly
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RemindersEstimateCard(state: TaskEditorUiState, onUpdate: ((EditorForm) -> EditorForm) -> Unit) {
    val form = state.form
    val colors = DisciplineTheme.colors
    EditorSection(stringResource(R.string.core_editor_section_reminders)) {
        if (form.dueTime == null) {
            Text(text = stringResource(R.string.core_editor_reminders_need_time), style = DisciplineTheme.typography.bodySmall, color = colors.textMuted)
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TaskEditorViewModel.REMINDER_OPTIONS.forEach { offset ->
                    DsChip(
                        label = reminderLabel(offset),
                        selected = offset in form.reminderOffsets,
                        onClick = {
                            onUpdate { f -> f.copy(reminderOffsets = if (offset in f.reminderOffsets) f.reminderOffsets - offset else f.reminderOffsets + offset) }
                        },
                    )
                }
            }
            FieldError(state.fieldErrors[EditorField.REMINDERS])
        }
        Spacer(Modifier.height(12.dp))
        Text(text = stringResource(R.string.core_editor_estimate), style = DisciplineTheme.typography.labelLarge, color = colors.textSecondary)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DsChip(label = stringResource(R.string.core_editor_no_estimate), selected = form.estimateMinutes == null, onClick = { onUpdate { it.copy(estimateMinutes = null) } })
            TaskEditorViewModel.ESTIMATE_OPTIONS.forEach { minutes ->
                DsChip(
                    label = formatMinutes(minutes),
                    selected = form.estimateMinutes == minutes,
                    onClick = { onUpdate { it.copy(estimateMinutes = minutes) } },
                )
            }
        }
        FieldError(state.fieldErrors[EditorField.ESTIMATE])
    }
}

@Composable
private fun reminderLabel(offset: Int): String = when {
    offset == 0 -> stringResource(R.string.core_reminder_at_time)
    offset % 1_440 == 0 -> stringResource(R.string.core_reminder_days_before, offset / 1_440)
    else -> stringResource(R.string.core_reminder_before, formatMinutes(offset))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VerificationCard(selected: VerificationMethod, onSelect: (VerificationMethod) -> Unit) {
    EditorSection(stringResource(R.string.core_editor_section_verification)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            VerificationMethod.entries.forEach { method ->
                DsChip(label = stringResource(method.labelRes()), selected = selected == method, onClick = { onSelect(method) })
            }
        }
        Text(
            text = stringResource(selected.descriptionRes()),
            style = DisciplineTheme.typography.bodySmall,
            color = DisciplineTheme.colors.textSecondary,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

@Composable
private fun DependenciesCard(state: TaskEditorUiState, onEdit: () -> Unit, onRemove: (Long) -> Unit) {
    val colors = DisciplineTheme.colors
    val selected = state.otherTasks.filter { it.id in state.form.dependsOn }
    EditorSection(stringResource(R.string.core_editor_section_dependencies)) {
        Text(text = stringResource(R.string.core_editor_dependencies_explain), style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
        selected.forEach { task ->
            DsListRow(
                title = task.title,
                leadingIcon = Icons.Outlined.AccountTree,
                trailing = {
                    IconButton(onClick = { onRemove(task.id) }) {
                        Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.core_cd_remove_item, task.title), tint = colors.textSecondary)
                    }
                },
            )
        }
        FieldError(state.fieldErrors[EditorField.DEPENDENCIES])
        Spacer(Modifier.height(8.dp))
        DsSecondaryButton(
            text = stringResource(R.string.core_editor_pick_dependencies),
            onClick = onEdit,
            enabled = state.otherTasks.isNotEmpty(),
            icon = Icons.Outlined.AccountTree,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun SubTasksCard(state: TaskEditorUiState, onUpdate: ((EditorForm) -> EditorForm) -> Unit) {
    val colors = DisciplineTheme.colors
    val subTasks = state.form.subTasks
    var draft by rememberSaveable { mutableStateOf("") }
    EditorSection(stringResource(R.string.core_editor_section_subtasks)) {
        subTasks.forEachIndexed { index, title ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                DsTextField(
                    value = title,
                    onValueChange = { v -> onUpdate { f -> f.copy(subTasks = f.subTasks.toMutableList().also { it[index] = v }) } },
                    label = stringResource(R.string.core_editor_subtask_n, index + 1),
                    maxLength = TaskEditorViewModel.SUBTASK_TITLE_MAX,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { onUpdate { f -> f.copy(subTasks = f.subTasks.filterIndexed { i, _ -> i != index }) } }) {
                    Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.core_cd_remove_item, title), tint = colors.textSecondary)
                }
            }
        }
        val canAdd = subTasks.size < TaskEditorViewModel.SUBTASKS_MAX
        Row(verticalAlignment = Alignment.CenterVertically) {
            DsTextField(
                value = draft,
                onValueChange = { draft = it },
                label = stringResource(R.string.core_editor_add_subtask),
                maxLength = TaskEditorViewModel.SUBTASK_TITLE_MAX,
                modifier = Modifier.weight(1f),
            )
            IconButton(
                enabled = canAdd && draft.isNotBlank(),
                onClick = {
                    val text = draft.trim()
                    if (text.isNotEmpty()) {
                        onUpdate { f -> f.copy(subTasks = f.subTasks + text) }
                        draft = ""
                    }
                },
            ) {
                Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.core_editor_add_subtask), tint = if (canAdd) colors.primarySoft else colors.textMuted)
            }
        }
        FieldError(state.fieldErrors[EditorField.SUBTASKS])
    }
}

// ----------------------------------------------------------------------------------------------
// Dialogs
// ----------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DatePickerModal(initial: LocalDate, minDate: LocalDate?, onPick: (LocalDate) -> Unit, onDismiss: () -> Unit) {
    val minMillis = minDate?.toEpochDay()?.times(DAY_MILLIS)
    val selectable = remember(minMillis) {
        object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean = minMillis == null || utcTimeMillis >= minMillis
        }
    }
    // DatePicker works in UTC midnight millis; LocalDate.toEpochDay maps 1:1 without zone math.
    val pickerState = rememberDatePickerState(
        initialSelectedDateMillis = initial.toEpochDay() * DAY_MILLIS,
        selectableDates = selectable,
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    pickerState.selectedDateMillis?.let { onPick(LocalDate.ofEpochDay(Math.floorDiv(it, DAY_MILLIS))) }
                    onDismiss()
                },
            ) { Text(stringResource(R.string.core_ok)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.core_cancel)) }
        },
    ) {
        DatePicker(state = pickerState)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimePickerModal(initial: LocalTime, onPick: (LocalTime) -> Unit, onDismiss: () -> Unit) {
    val pickerState = rememberTimePickerState(initialHour = initial.hour, initialMinute = initial.minute, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.core_editor_time)) },
        text = {
            // Clock faces and HH:mm are read left-to-right in Hebrew too.
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                TimePicker(state = pickerState)
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onPick(LocalTime.of(pickerState.hour, pickerState.minute))
                    onDismiss()
                },
            ) { Text(stringResource(R.string.core_ok)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.core_cancel)) } },
        containerColor = DisciplineTheme.colors.surface,
    )
}

@Composable
private fun DependenciesDialog(state: TaskEditorUiState, onConfirm: (Set<Long>) -> Unit, onDismiss: () -> Unit) {
    val colors = DisciplineTheme.colors
    var selection by remember { mutableStateOf(state.form.dependsOn) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.core_editor_pick_dependencies)) },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 420.dp)) {
                items(state.otherTasks, key = { it.id }) { task ->
                    val checked = task.id in selection
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .toggleable(
                                value = checked,
                                role = Role.Checkbox,
                                onValueChange = { selection = if (it) selection + task.id else selection - task.id },
                            ),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = checked, onCheckedChange = null)
                        Spacer(Modifier.width(8.dp))
                        Text(text = task.title, style = DisciplineTheme.typography.bodyLarge, color = colors.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onConfirm(selection)
                onDismiss()
            }) { Text(stringResource(R.string.core_ok)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.core_cancel)) } },
        containerColor = colors.surface,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NewCategoryDialog(onCreate: (String, String) -> Unit, onDismiss: () -> Unit) {
    val colors = DisciplineTheme.colors
    val swatches = listOf(colors.primary, colors.success, colors.warning, colors.danger, colors.xp, colors.primarySoft)
    var name by rememberSaveable { mutableStateOf("") }
    var colorIndex by rememberSaveable { mutableStateOf(0) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.core_editor_new_category)) },
        text = {
            Column {
                DsTextField(value = name, onValueChange = { name = it }, label = stringResource(R.string.core_editor_category_name), maxLength = 40)
                Spacer(Modifier.height(12.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    swatches.forEachIndexed { index, swatch ->
                        val label = stringResource(R.string.core_cd_color_n, index + 1)
                        Box(
                            modifier = Modifier
                                .size(48.dp)
                                .clip(CircleShape)
                                .clickable(role = Role.RadioButton) { colorIndex = index }
                                .semantics { contentDescription = label },
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(32.dp)
                                    .clip(CircleShape)
                                    .background(swatch)
                                    .border(if (index == colorIndex) 3.dp else 0.dp, colors.textPrimary, CircleShape),
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank(),
                onClick = {
                    onCreate(name, swatches[colorIndex].toHex())
                    onDismiss()
                },
            ) { Text(stringResource(R.string.core_create)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.core_cancel)) } },
        containerColor = colors.surface,
    )
}

/** Small colored dot used next to category names. */
@Composable
internal fun CategoryDot(colorHex: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(10.dp)
            .clip(CircleShape)
            .background(parseHexColor(colorHex, DisciplineTheme.colors.primary)),
    )
}
