package com.disciplineos.app.ui.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.outlined.CalendarViewWeek
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.automirrored.outlined.PlaylistAddCheck
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsEmptyState
import com.disciplineos.app.designsystem.component.DsErrorState
import com.disciplineos.app.designsystem.component.DsListRow
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsTextField
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.ui.common.UiState
import com.disciplineos.app.ui.common.horizontalGutter
import com.disciplineos.app.ui.common.relativeDayLabel
import com.disciplineos.app.ui.dashboard.SectionLabel
import com.disciplineos.core.model.Category
import com.disciplineos.core.model.OccurrenceWithTask

@Composable
fun TasksRoute(
    onOpenTask: (Long) -> Unit,
    onCreateTask: () -> Unit,
    onOpenWeek: () -> Unit,
    viewModel: TasksViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val openTask by rememberUpdatedState(onOpenTask)
    val openLabel = stringResource(R.string.core_action_open)
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is TasksEvent.Message -> {
                    val result = snackbarHostState.showSnackbar(
                        message = context.getString(event.text),
                        actionLabel = if (event.openTaskId != null) openLabel else null,
                        withDismissAction = true,
                        duration = SnackbarDuration.Long,
                    )
                    if (result == SnackbarResult.ActionPerformed && event.openTaskId != null) openTask(event.openTaskId)
                }
            }
        }
    }

    val colors = DisciplineTheme.colors
    Scaffold(
        containerColor = colors.background,
        topBar = {
            DsTopBar(
                title = stringResource(R.string.core_tasks_title),
                actions = {
                    IconButton(onClick = onOpenWeek) {
                        Icon(Icons.Outlined.CalendarViewWeek, contentDescription = stringResource(R.string.core_week_plan_title), tint = colors.textPrimary)
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            FloatingActionButton(onClick = onCreateTask, containerColor = colors.primary, contentColor = colors.textPrimary) {
                Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.core_cd_new_task))
            }
        },
    ) { inner ->
        BoxWithConstraints(Modifier.fillMaxSize().padding(top = inner.calculateTopPadding())) {
            val gutter = horizontalGutter(maxWidth)
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = 4.dp, bottom = inner.calculateBottomPadding() + 96.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item(key = "search") {
                    DsTextField(
                        value = state.filter.query,
                        onValueChange = viewModel::setQuery,
                        label = stringResource(R.string.core_tasks_search),
                        maxLength = 80,
                        modifier = Modifier.padding(horizontal = gutter),
                    )
                }
                item(key = "filters") {
                    FilterChips(
                        state = state,
                        gutter = gutter,
                        onKind = viewModel::setKind,
                        onCategory = viewModel::setCategory,
                    )
                }
                when (val content = state.content) {
                    UiState.Loading -> item(key = "loading") { DsLoadingState() }
                    is UiState.Error -> item(key = "error") {
                        DsErrorState(message = stringResource(R.string.core_tasks_error), onRetry = viewModel::retry)
                    }
                    UiState.Empty -> item(key = "empty") {
                        DsEmptyState(
                            title = stringResource(R.string.core_tasks_empty_title),
                            message = stringResource(R.string.core_tasks_empty_message),
                            icon = Icons.AutoMirrored.Outlined.PlaylistAddCheck,
                            actionLabel = stringResource(R.string.core_create_task),
                            onAction = onCreateTask,
                        )
                    }
                    is UiState.Success -> {
                        val data = content.data
                        if (data.isEmpty) {
                            item(key = "no-results") {
                                DsEmptyState(
                                    title = stringResource(R.string.core_tasks_no_results_title),
                                    message = stringResource(R.string.core_tasks_no_results_message),
                                    icon = Icons.Outlined.SearchOff,
                                    actionLabel = stringResource(R.string.core_tasks_clear_filters),
                                    onAction = viewModel::clearFilters,
                                )
                            }
                        } else {
                            val categoryNames = state.categories.associate { it.id to it.name }
                            occurrenceSection("overdue", R.string.core_section_overdue, data.overdue, gutter, state, categoryNames, true, viewModel::setCompleted, onOpenTask) { it.danger }
                            occurrenceSection("today", R.string.core_section_today, data.today, gutter, state, categoryNames, false, viewModel::setCompleted, onOpenTask) { it.primary }
                            occurrenceSection("upcoming", R.string.core_section_upcoming, data.upcoming, gutter, state, categoryNames, true, viewModel::setCompleted, onOpenTask) { it.primarySoft }
                            if (data.later.isNotEmpty()) {
                                if (data.upcoming.isEmpty()) {
                                    item(key = "label-later") {
                                        SectionLabel(
                                            text = stringResource(R.string.core_section_upcoming),
                                            count = data.later.size,
                                            accent = DisciplineTheme.colors.primarySoft,
                                            modifier = Modifier.padding(horizontal = gutter),
                                        )
                                    }
                                }
                                items(data.later, key = { "later-${it.id}" }) { task ->
                                    DsListRow(
                                        title = task.title,
                                        subtitle = relativeDayLabel(task.startDate, state.today),
                                        leadingIcon = Icons.Outlined.Event,
                                        onClick = { onOpenTask(task.id) },
                                        modifier = Modifier.padding(horizontal = gutter),
                                    )
                                }
                            }
                            if (data.recurring.isNotEmpty()) {
                                item(key = "label-recurring") {
                                    SectionLabel(
                                        text = stringResource(R.string.core_section_recurring),
                                        count = data.recurring.size,
                                        accent = DisciplineTheme.colors.xp,
                                        modifier = Modifier.padding(horizontal = gutter),
                                    )
                                }
                                items(data.recurring, key = { "recurring-${it.id}" }) { task ->
                                    RecurringTaskRow(
                                        task = task,
                                        onClick = { onOpenTask(task.id) },
                                        categoryName = task.categoryId?.let { categoryNames[it] },
                                        modifier = Modifier.padding(horizontal = gutter),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterChips(
    state: TasksUiState,
    gutter: androidx.compose.ui.unit.Dp,
    onKind: (KindFilter) -> Unit,
    onCategory: (Long?) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = gutter),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item(key = "all") {
            DsChip(label = stringResource(R.string.core_filter_all), selected = state.filter.kind == KindFilter.ALL, onClick = { onKind(KindFilter.ALL) })
        }
        item(key = "mandatory") {
            DsChip(
                label = stringResource(R.string.core_kind_mandatory),
                selected = state.filter.kind == KindFilter.MANDATORY,
                onClick = { onKind(KindFilter.MANDATORY) },
                leadingIcon = Icons.Filled.Flag,
            )
        }
        item(key = "optional") {
            DsChip(
                label = stringResource(R.string.core_kind_optional),
                selected = state.filter.kind == KindFilter.OPTIONAL,
                onClick = { onKind(KindFilter.OPTIONAL) },
            )
        }
        items(state.categories, key = { "cat-${it.id}" }) { category: Category ->
            DsChip(
                label = category.name,
                selected = state.filter.categoryId == category.id,
                onClick = { onCategory(category.id) },
            )
        }
    }
}

private fun LazyListScope.occurrenceSection(
    key: String,
    titleRes: Int,
    list: List<OccurrenceWithTask>,
    gutter: androidx.compose.ui.unit.Dp,
    state: TasksUiState,
    categoryNames: Map<Long, String>,
    showDate: Boolean,
    onToggle: (OccurrenceWithTask, Boolean) -> Unit,
    onOpenTask: (Long) -> Unit,
    accent: (com.disciplineos.app.designsystem.theme.DisciplineColors) -> Color,
) {
    if (list.isEmpty()) return
    item(key = "label-$key") {
        SectionLabel(
            text = stringResource(titleRes),
            count = list.size,
            accent = accent(DisciplineTheme.colors),
            modifier = Modifier.padding(horizontal = gutter),
        )
    }
    items(list, key = { "$key-${it.occurrence.id}" }) { item ->
        TaskOccurrenceRow(
            item = item,
            today = state.today,
            now = state.now,
            busy = item.occurrence.id in state.busyOccurrences,
            onCheckedChange = { checked -> onToggle(item, checked) },
            onClick = { onOpenTask(item.task.id) },
            showDate = showDate,
            showKind = true,
            categoryName = item.task.categoryId?.let { categoryNames[it] },
            modifier = Modifier.padding(horizontal = gutter),
        )
    }
}
