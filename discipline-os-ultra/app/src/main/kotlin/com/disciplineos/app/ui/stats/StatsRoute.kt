package com.disciplineos.app.ui.stats

import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.TrendingDown
import androidx.compose.material.icons.automirrored.filled.TrendingFlat
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.RateReview
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsEmptyState
import com.disciplineos.app.designsystem.component.DsErrorState
import com.disciplineos.app.designsystem.component.DsLinearProgress
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.component.DsSectionHeader
import com.disciplineos.app.designsystem.component.DsStatTile
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.core.domain.stats.DayStat
import com.disciplineos.core.domain.stats.StatsRange
import com.disciplineos.core.domain.stats.StatsSnapshot
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** Navigation entry point (see Routes.STATS). */
@Composable
fun StatsRoute(onOpenWeeklyReview: () -> Unit, viewModel: StatsViewModel = hiltViewModel()) {
    val range by viewModel.range.collectAsStateWithLifecycle()
    val stats by viewModel.stats.collectAsStateWithLifecycle()
    val screenTime by viewModel.screenTimeUi.collectAsStateWithLifecycle()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refreshScreenTime() }

    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    Scaffold(
        containerColor = colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { DsTopBar(title = stringResource(R.string.feat_stats_title)) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = spacing.screenGutter, vertical = spacing.md),
            verticalArrangement = Arrangement.spacedBy(spacing.lg),
        ) {
            RangeChips(range = range, onSelect = viewModel::selectRange)
            when (val s = stats) {
                StatsLoad.Loading -> DsLoadingState(Modifier.fillMaxWidth().height(240.dp), message = stringResource(R.string.feat_loading))
                StatsLoad.Error -> DsErrorState(stringResource(R.string.feat_stats_error), Modifier.fillMaxWidth(), onRetry = viewModel::retry)
                StatsLoad.Empty -> DsEmptyState(
                    title = stringResource(R.string.feat_stats_empty_title),
                    message = stringResource(R.string.feat_stats_empty_message),
                    icon = Icons.Filled.BarChart,
                    modifier = Modifier.fillMaxWidth(),
                )
                is StatsLoad.Ready -> StatsContent(s.snapshot)
            }
            WeeklyReviewCard(onOpenWeeklyReview)
            ScreenTimeSection(screenTime)
            Spacer(Modifier.height(spacing.lg))
        }
    }
}

@Composable
private fun RangeChips(range: StatsRange, onSelect: (StatsRange) -> Unit) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.sm),
        modifier = Modifier.horizontalScroll(rememberScrollState()),
    ) {
        StatsRange.entries.forEach { r ->
            DsChip(
                label = stringResource(
                    when (r) {
                        StatsRange.WEEK -> R.string.feat_stats_range_week
                        StatsRange.MONTH -> R.string.feat_stats_range_month
                        StatsRange.QUARTER -> R.string.feat_stats_range_quarter
                    },
                ),
                selected = r == range,
                onClick = { onSelect(r) },
            )
        }
    }
}

@Composable
private fun StatsContent(s: StatsSnapshot) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()

    TrendCard(s)

    // Tiles: 2 per row, each row shares width equally (works with large font sizes since heights are not fixed).
    val tiles = listOf(
        Triple(stringResource(R.string.feat_stats_tile_completion), stringResource(R.string.feat_percent_value, ChartMath.percent(s.completionRate)), Icons.Filled.CheckCircle) to colors.success,
        Triple(stringResource(R.string.feat_stats_tile_mandatory), stringResource(R.string.feat_percent_value, ChartMath.percent(s.mandatoryCompletionRate)), Icons.Filled.PriorityHigh) to colors.mandatory,
        Triple(stringResource(R.string.feat_stats_tile_focus), stringResource(R.string.feat_hours_value, ChartMath.hoursOneDecimal(s.focusMinutesTotal)), Icons.Filled.Timer) to colors.primary,
        Triple(stringResource(R.string.feat_stats_tile_streak), stringResource(R.string.feat_days_value, s.currentStreak), Icons.Filled.LocalFireDepartment) to colors.warning,
        Triple(stringResource(R.string.feat_stats_tile_best_streak), stringResource(R.string.feat_days_value, s.bestStreak), Icons.Filled.EmojiEvents) to colors.xp,
        Triple(stringResource(R.string.feat_stats_tile_bypass), s.bypassCount.toString(), Icons.Filled.LockOpen) to colors.textSecondary,
    )
    val captions = mapOf(5 to stringResource(R.string.feat_stats_bypass_caption))
    Column(verticalArrangement = Arrangement.spacedBy(spacing.sm)) {
        tiles.chunked(2).forEachIndexed { rowIndex, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(spacing.sm), modifier = Modifier.fillMaxWidth()) {
                row.forEachIndexed { colIndex, (t, accent) ->
                    DsStatTile(
                        label = t.first,
                        value = t.second,
                        icon = t.third,
                        accent = accent,
                        caption = captions[rowIndex * 2 + colIndex],
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }

    // ----- Bar chart: completed / total -----
    val bucketSize = ChartMath.bucketSizeFor(s.days.size)
    val dayLabel: (List<DayStat>) -> String = { chunk -> labelFor(chunk, s.range, locale) }
    val completionBuckets = ChartMath.bucketize(s.days, bucketSize, dayLabel, { it.completed }, { it.total })
    val totalCompleted = s.days.sumOf { it.completed }
    val totalTasks = s.days.sumOf { it.total }
    DsCard(Modifier.fillMaxWidth()) {
        ChartTitle(stringResource(R.string.feat_stats_chart_completion))
        Spacer(Modifier.height(spacing.md))
        CompletionBarChart(
            buckets = completionBuckets,
            contentDescription = stringResource(
                R.string.feat_stats_chart_completion_a11y,
                totalCompleted,
                totalTasks,
                ChartMath.percent(s.completionRate),
                s.days.size,
            ),
        )
        Spacer(Modifier.height(spacing.sm))
        LegendRow(
            listOf(
                stringResource(R.string.feat_stats_legend_completed) to colors.success,
                stringResource(R.string.feat_stats_legend_planned) to colors.surfaceSunken,
            ),
        )
    }

    // ----- Line chart: focus minutes -----
    val focusBuckets = ChartMath.bucketize(s.days, bucketSize, dayLabel, { it.focusMinutes }, { 0 })
    val bestFocus = focusBuckets.maxOfOrNull { it.value } ?: 0
    DsCard(Modifier.fillMaxWidth()) {
        ChartTitle(stringResource(R.string.feat_stats_chart_focus))
        Text(
            stringResource(R.string.feat_stats_focus_sessions, s.focusSessionsCompleted),
            style = MaterialTheme.typography.bodySmall,
            color = colors.textSecondary,
        )
        Spacer(Modifier.height(spacing.md))
        FocusLineChart(
            buckets = focusBuckets,
            contentDescription = stringResource(
                R.string.feat_stats_chart_focus_a11y,
                ChartMath.hoursOneDecimal(s.focusMinutesTotal),
                bestFocus,
                s.focusSessionsCompleted,
            ),
        )
    }

    // ----- Donut: completed by category -----
    DsCard(Modifier.fillMaxWidth()) {
        ChartTitle(stringResource(R.string.feat_stats_chart_category))
        Spacer(Modifier.height(spacing.md))
        val withData = s.byCategory.filter { it.completed > 0 }
        if (withData.isEmpty()) {
            Text(
                stringResource(R.string.feat_stats_category_empty),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textSecondary,
            )
        } else {
            val fallback = listOf(colors.primary, colors.success, colors.warning, colors.xp, colors.primarySoft, colors.danger)
            val uncategorized = stringResource(R.string.feat_stats_uncategorized)
            val slices = withData.mapIndexed { i, c ->
                DonutSlice(
                    label = c.name.ifBlank { uncategorized },
                    value = c.completed,
                    color = parseHexColor(c.colorHex) ?: fallback[i % fallback.size],
                )
            }
            val summary = slices.joinToString(separator = ", ") { "${it.label}: ${it.value}" }
            CategoryDonut(
                slices = slices,
                contentDescription = stringResource(R.string.feat_stats_chart_category_a11y, summary),
            )
        }
    }
}

@Composable
private fun TrendCard(s: StatsSnapshot) {
    val colors = DisciplineTheme.colors
    val direction = ChartMath.trend(s.trendDeltaPoints)
    val magnitude = ChartMath.trendMagnitude(s.trendDeltaPoints)
    val (icon, tint, text) = when (direction) {
        TrendDirection.UP -> Triple(Icons.AutoMirrored.Filled.TrendingUp, colors.success, stringResource(R.string.feat_stats_trend_up, magnitude))
        TrendDirection.DOWN -> Triple(Icons.AutoMirrored.Filled.TrendingDown, colors.warning, stringResource(R.string.feat_stats_trend_down, magnitude))
        TrendDirection.FLAT -> Triple(Icons.AutoMirrored.Filled.TrendingFlat, colors.textSecondary, stringResource(R.string.feat_stats_trend_flat))
    }
    DsCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics(mergeDescendants = true) {}) {
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.feat_stats_completion_headline),
                    style = MaterialTheme.typography.labelLarge,
                    color = colors.textSecondary,
                )
                Text(
                    stringResource(R.string.feat_percent_value, ChartMath.percent(s.completionRate)),
                    style = MaterialTheme.typography.displaySmall,
                    color = colors.textPrimary,
                )
                Text(text, style = MaterialTheme.typography.bodyMedium, color = tint)
            }
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(40.dp))
        }
    }
}

@Composable
private fun WeeklyReviewCard(onOpen: () -> Unit) {
    DsCard(Modifier.fillMaxWidth(), onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.RateReview, contentDescription = null, tint = DisciplineTheme.colors.primarySoft)
            Spacer(Modifier.size(DisciplineTheme.spacing.md))
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.feat_stats_weekly_review_title),
                    style = MaterialTheme.typography.titleMedium,
                    color = DisciplineTheme.colors.textPrimary,
                )
                Text(
                    stringResource(R.string.feat_stats_weekly_review_body),
                    style = MaterialTheme.typography.bodySmall,
                    color = DisciplineTheme.colors.textSecondary,
                )
            }
        }
    }
}

@Composable
private fun ScreenTimeSection(state: ScreenTimeUi) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val context = LocalContext.current
    DsSectionHeader(title = stringResource(R.string.feat_stats_screen_time_title))
    DsCard(Modifier.fillMaxWidth()) {
        when (state) {
            ScreenTimeUi.Loading -> DsLoadingState(Modifier.fillMaxWidth().height(96.dp))
            ScreenTimeUi.NoPermission -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Smartphone, contentDescription = null, tint = colors.primarySoft)
                    Spacer(Modifier.size(spacing.md))
                    Text(
                        stringResource(R.string.feat_stats_screen_time_permission_title),
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.textPrimary,
                    )
                }
                Spacer(Modifier.height(spacing.sm))
                Text(
                    stringResource(R.string.feat_stats_screen_time_permission_body),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textSecondary,
                )
                Spacer(Modifier.height(spacing.md))
                DsPrimaryButton(
                    text = stringResource(R.string.feat_stats_screen_time_permission_button),
                    onClick = {
                        try {
                            context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        } catch (_: ActivityNotFoundException) {
                            context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            ScreenTimeUi.Unavailable -> Text(
                stringResource(R.string.feat_stats_screen_time_unavailable),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textSecondary,
            )
            is ScreenTimeUi.Ready -> {
                val (h, m) = ChartMath.splitMinutes(state.totalMinutes)
                Text(
                    stringResource(R.string.feat_stats_screen_time_total, h, m),
                    style = MaterialTheme.typography.titleMedium,
                    color = colors.textPrimary,
                )
                Spacer(Modifier.height(spacing.md))
                if (state.top.isEmpty()) {
                    Text(
                        stringResource(R.string.feat_stats_screen_time_none),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                    )
                } else {
                    val max = state.top.maxOf { it.minutes }.coerceAtLeast(1)
                    Column(verticalArrangement = Arrangement.spacedBy(spacing.md)) {
                        state.top.forEach { row ->
                            val (rh, rm) = ChartMath.splitMinutes(row.minutes)
                            val duration = stringResource(R.string.feat_duration_hm, rh, rm)
                            Column(Modifier.semantics(mergeDescendants = true) {}) {
                                Row(Modifier.fillMaxWidth()) {
                                    Text(
                                        row.label,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = colors.textPrimary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Text(duration, style = MaterialTheme.typography.labelLarge, color = colors.textSecondary)
                                }
                                Spacer(Modifier.height(spacing.xs))
                                DsLinearProgress(progress = row.minutes.toFloat() / max, modifier = Modifier.fillMaxWidth())
                            }
                        }
                    }
                }
                Spacer(Modifier.height(spacing.sm))
                Text(
                    stringResource(R.string.feat_stats_screen_time_local_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textMuted,
                )
            }
        }
    }
    if (state is ScreenTimeUi.Ready || state is ScreenTimeUi.Unavailable) {
        DsSecondaryButton(
            text = stringResource(R.string.feat_stats_screen_time_manage),
            onClick = {
                try {
                    context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (_: ActivityNotFoundException) {
                    // Nothing else to open on this device.
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun ChartTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium,
        color = DisciplineTheme.colors.textPrimary,
        modifier = Modifier.semantics { heading() },
    )
}

@Composable
private fun LegendRow(items: List<Pair<String, Color>>) {
    Row(horizontalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.lg)) {
        items.forEach { (label, color) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(color),
                )
                Spacer(Modifier.size(DisciplineTheme.spacing.xs))
                Text(label, style = MaterialTheme.typography.labelMedium, color = DisciplineTheme.colors.textSecondary)
            }
        }
    }
}

private fun labelFor(chunk: List<DayStat>, range: StatsRange, locale: Locale): String {
    val first = chunk.first().date
    return when {
        chunk.size > 1 -> first.format(DateTimeFormatter.ofPattern("d/M", locale))
        range == StatsRange.WEEK -> first.dayOfWeek.getDisplayName(TextStyle.NARROW, locale)
        else -> first.dayOfMonth.toString()
    }
}

/** "#RRGGBB" / "#AARRGGBB" → Color, or null when malformed. */
private fun parseHexColor(hex: String): Color? =
    runCatching { Color(android.graphics.Color.parseColor(hex.trim())) }.getOrNull()
