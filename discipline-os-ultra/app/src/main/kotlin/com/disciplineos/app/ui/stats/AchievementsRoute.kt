package com.disciplineos.app.ui.stats

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.RateReview
import androidx.compose.material.icons.filled.SelfImprovement
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsEmptyState
import com.disciplineos.app.designsystem.component.DsErrorState
import com.disciplineos.app.designsystem.component.DsLinearProgress
import com.disciplineos.app.designsystem.component.DsLoadingState
import com.disciplineos.app.designsystem.component.DsTopBar
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.core.domain.gamification.AchievementView
import com.disciplineos.core.model.PlayerProgress
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Navigation entry point (see Routes.ACHIEVEMENTS). */
@Composable
fun AchievementsRoute(onBack: () -> Unit, viewModel: AchievementsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    Scaffold(
        containerColor = colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { DsTopBar(title = stringResource(R.string.feat_ach_title), onBack = onBack) },
    ) { padding ->
        when (val s = state) {
            AchievementsLoad.Loading -> DsLoadingState(Modifier.padding(padding).fillMaxSize(), message = stringResource(R.string.feat_loading))
            AchievementsLoad.Error -> DsErrorState(stringResource(R.string.feat_ach_error), Modifier.padding(padding).fillMaxSize(), onRetry = viewModel::retry)
            is AchievementsLoad.Ready -> LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 150.dp),
                modifier = Modifier.padding(padding).fillMaxSize(),
                contentPadding = PaddingValues(horizontal = spacing.screenGutter, vertical = spacing.md),
                horizontalArrangement = Arrangement.spacedBy(spacing.sm),
                verticalArrangement = Arrangement.spacedBy(spacing.sm),
            ) {
                item(span = { GridItemSpan(maxLineSpan) }, key = "header") {
                    LevelHeader(s.progress, s.unlockedCount, s.achievements.size)
                }
                if (s.achievements.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }, key = "empty") {
                        DsEmptyState(
                            title = stringResource(R.string.feat_ach_empty_title),
                            message = stringResource(R.string.feat_ach_empty_message),
                            icon = Icons.Filled.EmojiEvents,
                        )
                    }
                } else {
                    items(s.achievements, key = { it.def.id }) { a -> AchievementCell(a) }
                }
            }
        }
    }
}

@Composable
private fun LevelHeader(progress: PlayerProgress, unlocked: Int, total: Int) {
    val colors = DisciplineTheme.colors
    val spacing = DisciplineTheme.spacing
    val fraction = if (progress.xpForNextLevel <= 0) 0f else (progress.xpIntoLevel.toFloat() / progress.xpForNextLevel).coerceIn(0f, 1f)
    val a11y = stringResource(
        R.string.feat_ach_level_a11y,
        progress.level,
        progress.xpIntoLevel,
        progress.xpForNextLevel,
        unlocked,
        total,
    )
    DsCard(Modifier.fillMaxWidth().padding(bottom = spacing.sm)) {
        Column(Modifier.clearAndSetSemantics { contentDescription = a11y }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(56.dp)
                        .clip(CircleShape)
                        .background(colors.xp.copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(progress.level.toString(), style = MaterialTheme.typography.titleLarge, color = colors.xp)
                }
                Spacer(Modifier.size(spacing.md))
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.feat_ach_level, progress.level),
                        style = MaterialTheme.typography.titleLarge,
                        color = colors.textPrimary,
                    )
                    Text(
                        stringResource(R.string.feat_ach_total_xp, progress.totalXp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                    )
                }
            }
            Spacer(Modifier.height(spacing.md))
            DsLinearProgress(progress = fraction, color = colors.xp, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(spacing.xs))
            Text(
                stringResource(R.string.feat_ach_to_next, progress.xpForNextLevel - progress.xpIntoLevel),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
            )
            Spacer(Modifier.height(spacing.sm))
            Text(
                stringResource(R.string.feat_ach_unlocked_count, unlocked, total),
                style = MaterialTheme.typography.labelLarge,
                color = colors.primarySoft,
            )
        }
    }
}

@Composable
private fun AchievementCell(a: AchievementView) {
    val colors = DisciplineTheme.colors
    val unlocked = a.unlockedAt != null
    val locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()
    val dateText = a.unlockedAt?.let {
        it.atZone(ZoneId.systemDefault()).toLocalDate()
            .format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
    }
    val status = if (dateText != null) stringResource(R.string.feat_ach_unlocked_on, dateText) else stringResource(R.string.feat_ach_locked)
    val a11y = stringResource(R.string.feat_ach_cell_a11y, a.def.titleHe, a.def.descriptionHe, status, a.def.xpReward)
    DsCard(Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = a11y }) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            Box(
                Modifier
                    .size(52.dp)
                    .clip(CircleShape)
                    .background(if (unlocked) colors.xp.copy(alpha = 0.22f) else colors.surfaceSunken),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = if (unlocked) iconFor(a.def.iconKey) else Icons.Filled.Lock,
                    contentDescription = null,
                    tint = if (unlocked) colors.xp else colors.textMuted,
                )
            }
            Spacer(Modifier.height(DisciplineTheme.spacing.sm))
            Text(
                a.def.titleHe,
                style = MaterialTheme.typography.titleSmall,
                color = if (unlocked) colors.textPrimary else colors.textSecondary,
                textAlign = TextAlign.Center,
            )
            Text(
                a.def.descriptionHe,
                style = MaterialTheme.typography.bodySmall,
                color = colors.textSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.alpha(if (unlocked) 1f else 0.8f),
            )
            Spacer(Modifier.height(DisciplineTheme.spacing.xs))
            Text(
                if (dateText != null) dateText else stringResource(R.string.feat_xp_value, a.def.xpReward),
                style = MaterialTheme.typography.labelSmall,
                color = if (unlocked) colors.success else colors.textMuted,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** Maps catalog icon keys to Material icons; unknown keys fall back to a trophy. */
private fun iconFor(key: String): ImageVector = when (key.lowercase(Locale.ROOT)) {
    "fire", "streak", "flame" -> Icons.Filled.LocalFireDepartment
    "timer", "focus", "clock" -> Icons.Filled.Timer
    "check", "task", "done" -> Icons.Filled.CheckCircle
    "star", "xp" -> Icons.Filled.Star
    "shield", "mandatory" -> Icons.Filled.Shield
    "calendar", "week" -> Icons.Filled.CalendarMonth
    "bolt", "speed" -> Icons.Filled.Bolt
    "review" -> Icons.Filled.RateReview
    "calm", "zen", "recovery" -> Icons.Filled.SelfImprovement
    "premium", "level", "medal" -> Icons.Filled.WorkspacePremium
    else -> Icons.Filled.EmojiEvents
}
