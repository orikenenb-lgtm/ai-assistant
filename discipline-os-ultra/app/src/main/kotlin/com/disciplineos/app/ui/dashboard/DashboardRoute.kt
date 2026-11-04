package com.disciplineos.app.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsEmptyState
import com.disciplineos.app.designsystem.component.DsErrorState
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.ui.common.StaggeredItem
import com.disciplineos.app.ui.common.UiState
import com.disciplineos.app.ui.common.horizontalGutter
import com.disciplineos.app.ui.tasks.TaskOccurrenceRow
import com.disciplineos.core.domain.task.DayPlan
import com.disciplineos.core.model.OccurrenceWithTask
import kotlinx.coroutines.delay
import java.time.ZoneId

/**
 * Flagship home screen. Extra callbacks beyond the Routes contract have defaults so the contract
 * signature `DashboardRoute(onOpenTask, onCreateTask, onOpenFocus, onOpenCoach, onOpenBlocker)` holds.
 */
@Composable
fun DashboardRoute(
    onOpenTask: (Long) -> Unit,
    onCreateTask: () -> Unit,
    onOpenFocus: () -> Unit,
    onOpenCoach: () -> Unit,
    onOpenBlocker: () -> Unit,
    onOpenAchievements: () -> Unit = {},
    onOpenStats: () -> Unit = {},
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val openTask by rememberUpdatedState(onOpenTask)
    val openFocus by rememberUpdatedState(onOpenFocus)
    val openLabel = stringResource(R.string.core_action_open)

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is DashboardEvent.Message -> {
                    val result = snackbarHostState.showSnackbar(
                        message = context.getString(event.text),
                        actionLabel = if (event.openTaskId != null) openLabel else null,
                        withDismissAction = true,
                        duration = SnackbarDuration.Long,
                    )
                    if (result == SnackbarResult.ActionPerformed && event.openTaskId != null) {
                        openTask(event.openTaskId)
                    }
                }
                DashboardEvent.OpenFocus -> openFocus()
            }
        }
    }

    DashboardScreen(
        state = state,
        snackbarHostState = snackbarHostState,
        onToggle = viewModel::setCompleted,
        onRetry = viewModel::retry,
        onOpenTask = onOpenTask,
        onCreateTask = onCreateTask,
        onStartFocus = viewModel::startFocus,
        onOpenFocus = onOpenFocus,
        onOpenCoach = onOpenCoach,
        onOpenBlocker = onOpenBlocker,
        onOpenAchievements = onOpenAchievements,
        onOpenStats = onOpenStats,
    )
}

@Composable
private fun DashboardScreen(
    state: DashboardUiState,
    snackbarHostState: SnackbarHostState,
    onToggle: (OccurrenceWithTask, Boolean) -> Unit,
    onRetry: () -> Unit,
    onOpenTask: (Long) -> Unit,
    onCreateTask: () -> Unit,
    onStartFocus: () -> Unit,
    onOpenFocus: () -> Unit,
    onOpenCoach: () -> Unit,
    onOpenBlocker: () -> Unit,
    onOpenAchievements: () -> Unit,
    onOpenStats: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    val zone = remember { ZoneId.systemDefault() }
    // Entrance animation only for what's on screen at first composition.
    var playEntrance by rememberSaveable { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(900)
        playEntrance = false
    }

    Scaffold(
        containerColor = colors.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onCreateTask,
                containerColor = colors.primary,
                contentColor = colors.textPrimary,
            ) {
                Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.core_cd_new_task))
            }
        },
    ) { inner ->
        BoxWithConstraints(Modifier.fillMaxSize().padding(top = inner.calculateTopPadding())) {
            val gutter = horizontalGutter(maxWidth)
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = gutter, end = gutter, top = 12.dp, bottom = inner.calculateBottomPadding() + 96.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // Indices are assigned while building the list (not inside item lambdas, which run later).
                var index = 0
                val headerIndex = index++
                item(key = "header") {
                    StaggeredItem(index = headerIndex, enabled = playEntrance) {
                        DashboardHeader(hour = state.hour, today = state.today, onOpenCoach = onOpenCoach)
                    }
                }
                when (val plan = state.plan) {
                    UiState.Loading -> item(key = "loading") { DsLoadingState(message = stringResource(R.string.core_dash_loading)) }
                    is UiState.Error -> item(key = "error") {
                        DsErrorState(message = stringResource(R.string.core_dash_error), onRetry = onRetry)
                    }
                    UiState.Empty -> {
                        val emptyIndex = index++
                        item(key = "empty") {
                            StaggeredItem(index = emptyIndex, enabled = playEntrance) {
                                DsCard {
                                    DsEmptyState(
                                        title = stringResource(R.string.core_dash_empty_title),
                                        message = stringResource(R.string.core_dash_empty_message),
                                        icon = Icons.Outlined.EventAvailable,
                                        actionLabel = stringResource(R.string.core_create_task),
                                        onAction = onCreateTask,
                                    )
                                }
                            }
                        }
                    }
                    is UiState.Success -> {
                        val heroIndex = index++
                        item(key = "hero") {
                            StaggeredItem(index = heroIndex, enabled = playEntrance) { TodayProgressCard(plan = plan.data) }
                        }
                    }
                }
                val blockerIndex = index++
                item(key = "blocker") {
                    StaggeredItem(index = blockerIndex, enabled = playEntrance) {
                        BlockerStatusCard(status = state.blocker, zone = zone, onClick = onOpenBlocker)
                    }
                }
                (state.plan as? UiState.Success)?.data?.let { plan ->
                    taskSections(plan = plan, state = state, onToggle = onToggle, onOpenTask = onOpenTask)
                }
                state.progress?.let { progress ->
                    val i = index++
                    item(key = "progress") {
                        StaggeredItem(index = i, enabled = playEntrance) { PlayerProgressCard(progress = progress, onClick = onOpenAchievements) }
                    }
                }
                val focusIndex = index++
                item(key = "focus") {
                    StaggeredItem(index = focusIndex, enabled = playEntrance) {
                        FocusQuickCard(focus = state.focus, zone = zone, onStart = onStartFocus, onOpen = onOpenFocus)
                    }
                }
                val coachIndex = index++
                item(key = "coach") {
                    StaggeredItem(index = coachIndex, enabled = playEntrance) { CoachCard(onClick = onOpenCoach) }
                }
                state.week?.let { week ->
                    val i = index++
                    item(key = "week") {
                        StaggeredItem(index = i, enabled = playEntrance) { WeekStatsStrip(stats = week, today = state.today, onClick = onOpenStats) }
                    }
                }
            }
        }
    }
}

private fun LazyListScope.taskSections(
    plan: DayPlan,
    state: DashboardUiState,
    onToggle: (OccurrenceWithTask, Boolean) -> Unit,
    onOpenTask: (Long) -> Unit,
) {
    fun section(key: String, titleRes: Int, list: List<OccurrenceWithTask>, accentKind: SectionAccent) {
        if (list.isEmpty()) return
        item(key = "label-$key") {
            val colors = DisciplineTheme.colors
            val accent = when (accentKind) {
                SectionAccent.OVERDUE -> colors.danger
                SectionAccent.MANDATORY -> colors.mandatory
                SectionAccent.OPTIONAL -> colors.optional
            }
            SectionLabel(text = stringResource(titleRes), count = list.size, accent = accent)
        }
        items(list, key = { "$key-${it.occurrence.id}" }) { item ->
            TaskOccurrenceRow(
                item = item,
                today = state.today,
                now = state.now,
                busy = item.occurrence.id in state.busyOccurrences,
                onCheckedChange = { checked -> onToggle(item, checked) },
                onClick = { onOpenTask(item.task.id) },
                showDate = key == "overdue",
            )
        }
    }
    section("overdue", R.string.core_section_overdue, plan.overdue, SectionAccent.OVERDUE)
    section("mandatory", R.string.core_section_mandatory, plan.mandatory, SectionAccent.MANDATORY)
    section("optional", R.string.core_section_optional, plan.optional, SectionAccent.OPTIONAL)
}

private enum class SectionAccent { OVERDUE, MANDATORY, OPTIONAL }
