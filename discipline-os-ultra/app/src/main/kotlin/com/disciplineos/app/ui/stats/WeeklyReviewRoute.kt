package com.disciplineos.app.ui.stats

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Celebration
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsChip
import com.disciplineos.app.designsystem.component.DsErrorState
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsStatTile
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.core.domain.gamification.WeeklyReview
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.util.Locale

/** Navigation entry point (see Routes.WEEKLY_REVIEW). */
@Composable
fun WeeklyReviewRoute(onBack: () -> Unit, viewModel: WeeklyReviewViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val week by viewModel.week.collectAsStateWithLifecycle()
    val finish by viewModel.finish.collectAsStateWithLifecycle()
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing

    Scaffold(
        containerColor = colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { DsTopBar(title = stringResource(R.string.feat_review_title), onBack = onBack) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = spacing.screenGutter, vertical = spacing.md),
            verticalArrangement = Arrangement.spacedBy(spacing.lg),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(spacing.sm)) {
                DsChip(
                    label = stringResource(R.string.feat_review_this_week),
                    selected = week == ReviewWeek.THIS_WEEK,
                    onClick = { viewModel.selectWeek(ReviewWeek.THIS_WEEK) },
                )
                DsChip(
                    label = stringResource(R.string.feat_review_last_week),
                    selected = week == ReviewWeek.LAST_WEEK,
                    onClick = { viewModel.selectWeek(ReviewWeek.LAST_WEEK) },
                )
            }
            when (val s = state) {
                WeeklyReviewLoad.Loading -> DsLoadingState(Modifier.fillMaxWidth().height(240.dp), message = stringResource(R.string.feat_loading))
                WeeklyReviewLoad.Error -> DsErrorState(stringResource(R.string.feat_review_error), Modifier.fillMaxWidth(), onRetry = viewModel::retry)
                is WeeklyReviewLoad.Ready -> ReviewContent(
                    review = s.review,
                    alreadyCompleted = s.alreadyCompleted,
                    finish = finish,
                    onFinish = viewModel::finishReview,
                )
            }
        }
    }
}

@Composable
private fun ReviewContent(
    review: WeeklyReview,
    alreadyCompleted: Boolean,
    finish: FinishResult,
    onFinish: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()
    val dateFormat = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)

    Text(
        stringResource(R.string.feat_review_range, review.weekStart.format(dateFormat), review.weekStart.plusDays(6).format(dateFormat)),
        style = MaterialTheme.typography.bodyMedium,
        color = colors.textSecondary,
    )

    // Supportive headline chosen from the data, never shaming.
    val headline = when {
        review.total == 0 -> stringResource(R.string.feat_review_headline_empty)
        review.mandatoryCompletionRate >= 0.9f -> stringResource(R.string.feat_review_headline_great)
        review.mandatoryCompletionRate >= 0.5f -> stringResource(R.string.feat_review_headline_good)
        else -> stringResource(R.string.feat_review_headline_restart)
    }
    DsCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = colors.xp)
            Spacer(Modifier.size(spacing.md))
            Text(headline, style = MaterialTheme.typography.titleMedium, color = colors.textPrimary)
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(spacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(spacing.sm), modifier = Modifier.fillMaxWidth()) {
            DsStatTile(
                label = stringResource(R.string.feat_review_tile_done),
                value = stringResource(R.string.feat_count_of_total, review.completed, review.total),
                icon = Icons.Filled.CheckCircle,
                accent = colors.success,
                modifier = Modifier.weight(1f),
            )
            DsStatTile(
                label = stringResource(R.string.feat_review_tile_mandatory),
                value = stringResource(R.string.feat_percent_value, ChartMath.percent(review.mandatoryCompletionRate)),
                icon = Icons.Filled.PriorityHigh,
                accent = colors.mandatory,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(spacing.sm), modifier = Modifier.fillMaxWidth()) {
            DsStatTile(
                label = stringResource(R.string.feat_review_tile_focus),
                value = stringResource(R.string.feat_hours_value, ChartMath.hoursOneDecimal(review.focusMinutes)),
                icon = Icons.Filled.Timer,
                accent = colors.primary,
                modifier = Modifier.weight(1f),
            )
            DsStatTile(
                label = stringResource(R.string.feat_review_tile_xp),
                value = stringResource(R.string.feat_xp_value, review.xpEarned),
                icon = Icons.Filled.Star,
                accent = colors.xp,
                modifier = Modifier.weight(1f),
            )
        }
    }

    review.bestDay?.let { day ->
        Text(
            stringResource(R.string.feat_review_best_day, day.dayOfWeek.getDisplayName(TextStyle.FULL, locale)),
            style = MaterialTheme.typography.bodyLarge,
            color = colors.textPrimary,
        )
    }

    BulletCard(
        title = stringResource(R.string.feat_review_highlights),
        icon = Icons.Filled.Celebration,
        items = review.highlightsHe,
        empty = stringResource(R.string.feat_review_highlights_empty),
    )
    BulletCard(
        title = stringResource(R.string.feat_review_suggestions),
        icon = Icons.Filled.Lightbulb,
        items = review.suggestionsHe,
        empty = stringResource(R.string.feat_review_suggestions_empty),
    )

    val doneAlready = alreadyCompleted || finish is FinishResult.AlreadyDone || finish is FinishResult.Awarded
    val status = when (finish) {
        is FinishResult.Awarded -> stringResource(R.string.feat_review_finished_xp, finish.xp)
        FinishResult.AlreadyDone -> stringResource(R.string.feat_review_already_done)
        FinishResult.Failed -> stringResource(R.string.feat_review_finish_failed)
        else -> if (alreadyCompleted) stringResource(R.string.feat_review_already_done) else null
    }
    if (status != null) {
        Text(
            status,
            style = MaterialTheme.typography.bodyMedium,
            color = if (finish == FinishResult.Failed) colors.danger else colors.success,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
    DsPrimaryButton(
        text = stringResource(if (doneAlready) R.string.feat_review_finished else R.string.feat_review_finish),
        onClick = onFinish,
        enabled = !doneAlready,
        loading = finish == FinishResult.Saving,
        icon = Icons.Filled.CheckCircle,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(spacing.lg))
}

@Composable
private fun BulletCard(title: String, icon: ImageVector, items: List<String>, empty: String) {
    val colors = DisciplineTheme.colors
    DsCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = colors.primarySoft)
            Spacer(Modifier.size(DisciplineTheme.spacing.sm))
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                color = colors.textPrimary,
                modifier = Modifier.semantics { heading() },
            )
        }
        Spacer(Modifier.height(DisciplineTheme.spacing.sm))
        if (items.isEmpty()) {
            Text(empty, style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary)
        } else {
            items.forEach { line ->
                Text(
                    "• $line",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textPrimary,
                    modifier = Modifier.padding(vertical = DisciplineTheme.spacing.xxs),
                )
            }
        }
    }
}
