package com.disciplineos.app.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Today
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsBadge
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsErrorState
import com.disciplineos.app.designsystem.component.DsLinearProgress
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.ui.common.Formatters
import com.disciplineos.app.ui.common.UiState
import com.disciplineos.app.ui.common.currentLocale
import com.disciplineos.app.ui.common.horizontalGutter
import com.disciplineos.core.domain.task.DayPlan
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.OccurrenceWithTask
import java.time.LocalDate

@Composable
fun WeekPlanRoute(
    onBack: () -> Unit,
    onOpenTask: (Long) -> Unit,
    viewModel: WeekPlanViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val colors = DisciplineTheme.colors
    val locale = currentLocale()
    Scaffold(
        containerColor = colors.background,
        topBar = { DsTopBar(title = stringResource(R.string.core_week_plan_title), onBack = onBack) },
    ) { inner ->
        BoxWithConstraints(Modifier.fillMaxSize().padding(inner)) {
            val gutter = horizontalGutter(maxWidth)
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = gutter, end = gutter, top = 4.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(key = "nav") {
                    val start = state.weekStart
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = viewModel::previousWeek) {
                            Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = stringResource(R.string.core_week_prev), tint = colors.textPrimary)
                        }
                        Text(
                            text = if (start == null) "" else stringResource(
                                R.string.core_week_range,
                                Formatters.shortDate(start, locale),
                                Formatters.shortDate(start.plusDays(6), locale),
                            ),
                            style = DisciplineTheme.typography.titleMedium,
                            color = colors.textPrimary,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.weight(1f).semantics { heading() },
                        )
                        IconButton(onClick = viewModel::nextWeek) {
                            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = stringResource(R.string.core_week_next), tint = colors.textPrimary)
                        }
                        val containsToday = start != null && !state.today.isBefore(start) && !state.today.isAfter(start.plusDays(6))
                        if (!containsToday && start != null) {
                            IconButton(onClick = viewModel::thisWeek) {
                                Icon(Icons.Outlined.Today, contentDescription = stringResource(R.string.core_week_this), tint = colors.primarySoft)
                            }
                        }
                    }
                }
                item(key = "smart") {
                    DsCard(modifier = Modifier.fillMaxWidth()) {
                        Text(text = stringResource(R.string.core_smart_title), style = DisciplineTheme.typography.titleMedium, color = colors.textPrimary)
                        Text(text = stringResource(R.string.core_smart_explain), style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
                        Spacer(Modifier.height(12.dp))
                        DsPrimaryButton(
                            text = stringResource(R.string.core_smart_button),
                            onClick = viewModel::planSmart,
                            loading = state.proposal == ProposalState.Running,
                            enabled = state.days is UiState.Success,
                            icon = Icons.Filled.AutoAwesome,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                when (val proposal = state.proposal) {
                    is ProposalState.Ready -> item(key = "proposal") {
                        ProposalCard(proposal, state.today, onOpenTask = onOpenTask, onDismiss = viewModel::dismissProposal)
                    }
                    ProposalState.NothingToPlan -> item(key = "proposal-empty") {
                        InfoCard(stringResource(R.string.core_smart_nothing), onDismiss = viewModel::dismissProposal)
                    }
                    ProposalState.Failed -> item(key = "proposal-failed") {
                        InfoCard(stringResource(R.string.core_smart_failed), onDismiss = viewModel::dismissProposal)
                    }
                    ProposalState.None, ProposalState.Running -> Unit
                }
                when (val days = state.days) {
                    UiState.Loading, UiState.Empty -> item(key = "loading") { DsLoadingState() }
                    is UiState.Error -> item(key = "error") { DsErrorState(message = stringResource(R.string.core_week_error)) }
                    is UiState.Success -> items(days.data, key = { it.date.toEpochDay() }) { day ->
                        DayCard(day = day, today = state.today, onOpenTask = onOpenTask)
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCard(day: DayPlan, today: LocalDate, onOpenTask: (Long) -> Unit) {
    val colors = DisciplineTheme.colors
    val locale = currentLocale()
    val isToday = day.date == today
    val items = (day.mandatory + day.optional).distinctBy { it.occurrence.id }
    DsCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = Formatters.fullDay(day.date.dayOfWeek, locale),
                    style = DisciplineTheme.typography.titleMedium,
                    color = if (isToday) colors.primarySoft else colors.textPrimary,
                    modifier = Modifier.semantics { heading() },
                )
                Text(text = Formatters.shortDate(day.date, locale), style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
            }
            if (isToday) {
                DsBadge(text = stringResource(R.string.core_today), color = colors.primary)
                Spacer(Modifier.width(8.dp))
            }
            Text(
                text = stringResource(R.string.core_done_of_total, day.completedCount, day.totalCount),
                style = DisciplineTheme.typography.labelLarge,
                color = colors.textSecondary,
            )
        }
        if (day.totalCount > 0) {
            Spacer(Modifier.height(8.dp))
            DsLinearProgress(progress = day.progress, color = if (day.allMandatoryDone) colors.success else colors.primary)
        }
        Spacer(Modifier.height(6.dp))
        if (items.isEmpty()) {
            Text(text = stringResource(R.string.core_week_day_empty), style = DisciplineTheme.typography.bodySmall, color = colors.textMuted)
        } else {
            items.forEach { CompactTaskLine(it, onClick = { onOpenTask(it.task.id) }) }
        }
    }
}

@Composable
private fun CompactTaskLine(item: OccurrenceWithTask, onClick: () -> Unit) {
    val colors = DisciplineTheme.colors
    val done = item.occurrence.status == OccurrenceStatus.COMPLETED
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(10.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(if (done) colors.success else colors.kindColor(item.task.kind)))
        Spacer(Modifier.width(10.dp))
        Text(
            text = item.task.title,
            style = DisciplineTheme.typography.bodyMedium,
            color = if (done) colors.textMuted else colors.textPrimary,
            textDecoration = if (done) TextDecoration.LineThrough else null,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        item.task.dueTime?.let {
            Text(text = Formatters.time(it), style = DisciplineTheme.typography.labelMedium, color = colors.textSecondary)
        }
    }
}

@Composable
private fun ProposalCard(proposal: ProposalState.Ready, today: LocalDate, onOpenTask: (Long) -> Unit, onDismiss: () -> Unit) {
    val colors = DisciplineTheme.colors
    val locale = currentLocale()
    val byDate = proposal.plan.blocks.sortedWith(compareBy({ it.date }, { it.start })).groupBy { it.date }
    DsCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.core_smart_result_title),
                style = DisciplineTheme.typography.titleMedium,
                color = colors.textPrimary,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onDismiss) {
                Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.core_smart_dismiss), tint = colors.textSecondary)
            }
        }
        Text(text = stringResource(R.string.core_smart_display_only), style = DisciplineTheme.typography.bodySmall, color = colors.textMuted)
        byDate.forEach { (date, blocks) ->
            Spacer(Modifier.height(10.dp))
            Text(
                text = if (date == today) stringResource(R.string.core_today) else Formatters.fullDay(date.dayOfWeek, locale),
                style = DisciplineTheme.typography.labelLarge,
                color = colors.primarySoft,
            )
            blocks.forEach { block ->
                val task = proposal.tasks[block.taskId]
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .clickable(role = Role.Button) { onOpenTask(block.taskId) }
                        .padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // Times are LTR digits; keep "16:00–16:30" ordering stable in Hebrew.
                    Text(
                        text = "\u2066${Formatters.time(block.start)}–${Formatters.time(block.end)}\u2069",
                        style = DisciplineTheme.typography.labelLarge,
                        color = colors.textSecondary,
                    )
                    Spacer(Modifier.width(12.dp))
                    Box(Modifier.size(8.dp).clip(CircleShape).background(task?.let { colors.kindColor(it.kind) } ?: colors.outline))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = task?.title ?: stringResource(R.string.core_smart_unknown_task),
                        style = DisciplineTheme.typography.bodyMedium,
                        color = colors.textPrimary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        if (proposal.plan.unscheduled.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            Text(
                text = stringResource(R.string.core_smart_unscheduled, proposal.plan.unscheduled.size),
                style = DisciplineTheme.typography.labelLarge,
                color = colors.warning,
            )
            // The contract does not pin whether ids are occurrence or task ids; resolve occurrence first.
            val titles = proposal.plan.unscheduled.mapNotNull { id ->
                (proposal.byOccurrence[id] ?: proposal.tasks[id])?.title
            }.distinct()
            if (titles.isNotEmpty()) {
                Text(text = titles.joinToString(", "), style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
            }
        }
    }
}

@Composable
private fun InfoCard(text: String, onDismiss: () -> Unit) {
    val colors = DisciplineTheme.colors
    DsCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(text = text, style = DisciplineTheme.typography.bodyMedium, color = colors.textSecondary, modifier = Modifier.weight(1f))
            IconButton(onClick = onDismiss) {
                Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.core_smart_dismiss), tint = colors.textSecondary)
            }
        }
    }
}
