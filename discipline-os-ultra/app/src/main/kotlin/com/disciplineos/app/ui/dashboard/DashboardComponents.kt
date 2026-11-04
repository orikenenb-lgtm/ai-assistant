package com.disciplineos.app.ui.dashboard

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsCard
import com.disciplineos.app.designsystem.component.DsLinearProgress
import com.disciplineos.app.designsystem.component.DsPreviewSurface
import com.disciplineos.app.designsystem.component.DsPreviews
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.component.DsProgressRing
import com.disciplineos.app.designsystem.component.DsSecondaryButton
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.ui.common.Formatters
import com.disciplineos.app.ui.common.currentLocale
import com.disciplineos.app.ui.common.formatMinutes
import com.disciplineos.core.domain.stats.DayStat
import com.disciplineos.core.domain.stats.StatsSnapshot
import com.disciplineos.core.domain.task.DayPlan
import com.disciplineos.core.model.FocusPhase
import com.disciplineos.core.model.FocusState
import com.disciplineos.core.model.PlayerProgress
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt

@Composable
internal fun DashboardHeader(hour: Int, today: LocalDate, onOpenCoach: () -> Unit, modifier: Modifier = Modifier) {
    val colors = DisciplineTheme.colors
    val locale = currentLocale()
    Row(modifier = modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(Formatters.greetingRes(hour)),
                style = DisciplineTheme.typography.headlineMedium,
                color = colors.textPrimary,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = Formatters.fullDate(today, locale),
                style = DisciplineTheme.typography.bodyMedium,
                color = colors.textSecondary,
            )
        }
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(Brush.linearGradient(listOf(colors.primary.copy(alpha = 0.35f), colors.xp.copy(alpha = 0.35f)))),
            contentAlignment = Alignment.Center,
        ) {
            androidx.compose.material3.IconButton(onClick = onOpenCoach) {
                Icon(Icons.Filled.AutoAwesome, contentDescription = stringResource(R.string.core_cd_open_coach), tint = colors.textPrimary)
            }
        }
    }
}

/** Hero: big animated ring of today's completion plus mandatory status. */
@Composable
internal fun TodayProgressCard(plan: DayPlan, modifier: Modifier = Modifier) {
    val colors = DisciplineTheme.colors
    val remaining = plan.remainingMandatory()
    val ringColor = if (plan.allMandatoryDone) colors.success else colors.primary
    val mandatoryTotal = plan.mandatory.size + plan.overdue.size
    val mandatoryDone = mandatoryTotal - remaining
    DsCard(modifier = modifier.fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            DsProgressRing(progress = plan.progress, size = 132.dp, stroke = 12.dp, color = ringColor) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = stringResource(R.string.core_percent, (plan.progress * 100).roundToInt()),
                        style = DisciplineTheme.typography.headlineMedium,
                        color = colors.textPrimary,
                    )
                    Text(
                        text = stringResource(R.string.core_done_of_total, plan.completedCount, plan.totalCount),
                        style = DisciplineTheme.typography.labelMedium,
                        color = colors.textSecondary,
                    )
                }
            }
            Spacer(Modifier.width(18.dp))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = stringResource(R.string.core_dash_today_title),
                    style = DisciplineTheme.typography.titleMedium,
                    color = colors.textPrimary,
                )
                Text(
                    text = if (plan.allMandatoryDone) {
                        stringResource(R.string.core_dash_all_mandatory_done)
                    } else {
                        stringResource(R.string.core_dash_mandatory_remaining, remaining)
                    },
                    style = DisciplineTheme.typography.bodyMedium,
                    color = if (plan.allMandatoryDone) colors.success else colors.mandatory,
                )
                if (mandatoryTotal > 0) {
                    Spacer(Modifier.height(4.dp))
                    DsLinearProgress(
                        progress = mandatoryDone.toFloat() / mandatoryTotal,
                        color = if (plan.allMandatoryDone) colors.success else colors.mandatory,
                    )
                    Text(
                        text = stringResource(R.string.core_dash_mandatory_ratio, mandatoryDone, mandatoryTotal),
                        style = DisciplineTheme.typography.labelSmall,
                        color = colors.textMuted,
                    )
                }
            }
        }
    }
}

@Composable
internal fun BlockerStatusCard(status: BlockerStatus, zone: ZoneId, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = DisciplineTheme.colors
    val title: String
    val subtitle: String
    val accent: Color
    val icon: ImageVector
    when (status) {
        is BlockerStatus.Active -> {
            accent = colors.mandatory
            icon = Icons.Filled.Shield
            title = if (status.focusDriven && status.pendingMandatory == 0) {
                stringResource(R.string.core_blocker_active_focus)
            } else {
                stringResource(R.string.core_blocker_active, status.pendingMandatory)
            }
            subtitle = stringResource(R.string.core_blocker_active_sub)
        }
        BlockerStatus.Open -> {
            accent = colors.success
            icon = Icons.Outlined.LockOpen
            title = stringResource(R.string.core_blocker_open)
            subtitle = stringResource(R.string.core_blocker_open_sub)
        }
        is BlockerStatus.Recovery -> {
            accent = colors.xp
            icon = Icons.Outlined.HealthAndSafety
            title = stringResource(R.string.core_blocker_recovery)
            subtitle = status.until?.let { stringResource(R.string.core_blocker_recovery_until, Formatters.dateTime(it, zone, currentLocale())) }
                ?: stringResource(R.string.core_blocker_recovery_sub)
        }
        is BlockerStatus.Bypass -> {
            accent = colors.primarySoft
            icon = Icons.Outlined.LockOpen
            title = stringResource(R.string.core_blocker_bypass)
            subtitle = status.until?.let { stringResource(R.string.core_blocker_bypass_until, Formatters.time(it, zone)) }
                ?: stringResource(R.string.core_blocker_bypass)
        }
        BlockerStatus.Disabled -> {
            accent = colors.textSecondary
            icon = Icons.Outlined.Shield
            title = stringResource(R.string.core_blocker_disabled)
            subtitle = stringResource(R.string.core_blocker_disabled_sub)
        }
        BlockerStatus.Unavailable -> {
            accent = colors.textMuted
            icon = Icons.Outlined.Shield
            title = stringResource(R.string.core_blocker_unavailable)
            subtitle = stringResource(R.string.core_blocker_unavailable_sub)
        }
    }
    DsCard(modifier = modifier.fillMaxWidth(), onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(icon = icon, tint = accent)
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(text = title, style = DisciplineTheme.typography.titleMedium, color = colors.textPrimary)
                Text(text = subtitle, style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.textMuted)
        }
    }
}

@Composable
internal fun PlayerProgressCard(progress: PlayerProgress, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = DisciplineTheme.colors
    val levelFraction = if (progress.xpForNextLevel <= 0) 0f else progress.xpIntoLevel.toFloat() / progress.xpForNextLevel
    DsCard(modifier = modifier.fillMaxWidth(), onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(icon = Icons.Filled.LocalFireDepartment, tint = colors.warning)
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.core_streak_days, progress.currentStreakDays),
                    style = DisciplineTheme.typography.titleMedium,
                    color = colors.textPrimary,
                )
                Text(
                    text = stringResource(R.string.core_streak_best, progress.bestStreakDays, progress.streakFreezesAvailable),
                    style = DisciplineTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Filled.WorkspacePremium, contentDescription = null, tint = colors.xp, modifier = Modifier.size(22.dp))
                Text(
                    text = stringResource(R.string.core_level, progress.level),
                    style = DisciplineTheme.typography.labelLarge,
                    color = colors.textPrimary,
                )
            }
        }
        Spacer(Modifier.height(14.dp))
        DsLinearProgress(progress = levelFraction, color = colors.xp)
        Spacer(Modifier.height(6.dp))
        Text(
            text = stringResource(R.string.core_xp_progress, progress.xpIntoLevel, progress.xpForNextLevel, progress.totalXp),
            style = DisciplineTheme.typography.labelSmall,
            color = colors.textMuted,
        )
    }
}

@Composable
internal fun FocusQuickCard(focus: FocusState?, zone: ZoneId, onStart: () -> Unit, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val colors = DisciplineTheme.colors
    val phase = focus?.phase ?: FocusPhase.IDLE
    val active = phase != FocusPhase.IDLE
    DsCard(modifier = modifier.fillMaxWidth(), onClick = if (active) onOpen else null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(icon = if (active) Icons.Outlined.Timer else Icons.Filled.Bolt, tint = colors.primarySoft)
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(if (active) phase.labelRes() else R.string.core_focus_title),
                    style = DisciplineTheme.typography.titleMedium,
                    color = colors.textPrimary,
                )
                val endsAt = focus?.phaseEndsAt
                val subtitle = when {
                    !active -> stringResource(R.string.core_focus_sub)
                    focus?.paused == true -> stringResource(R.string.core_focus_paused)
                    endsAt != null -> stringResource(R.string.core_focus_ends_at, Formatters.time(endsAt, zone))
                    else -> stringResource(R.string.core_focus_sub)
                }
                Text(text = subtitle, style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
            }
        }
        if (!active) {
            Spacer(Modifier.height(14.dp))
            DsPrimaryButton(
                text = stringResource(R.string.core_focus_start),
                onClick = onStart,
                icon = Icons.Filled.PlayArrow,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

private fun FocusPhase.labelRes(): Int = when (this) {
    FocusPhase.IDLE -> R.string.core_focus_title
    FocusPhase.WORK -> R.string.core_focus_phase_work
    FocusPhase.SHORT_BREAK -> R.string.core_focus_phase_short_break
    FocusPhase.LONG_BREAK -> R.string.core_focus_phase_long_break
}

@Composable
internal fun CoachCard(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = DisciplineTheme.colors
    DsCard(modifier = modifier.fillMaxWidth(), onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(icon = Icons.Filled.AutoAwesome, tint = colors.xp)
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(text = stringResource(R.string.core_coach_title), style = DisciplineTheme.typography.titleMedium, color = colors.textPrimary)
                Text(text = stringResource(R.string.core_coach_sub), style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.textMuted)
        }
    }
}

/** 7 mini bars (completion per day) + headline metrics. Bars run in reading direction. */
@Composable
internal fun WeekStatsStrip(stats: StatsSnapshot, today: LocalDate, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = DisciplineTheme.colors
    val locale = currentLocale()
    val days = stats.days.sortedBy { it.date }.takeLast(7)
    val summary = stringResource(
        R.string.core_week_summary,
        (stats.completionRate * 100).roundToInt(),
        formatMinutes(stats.focusMinutesTotal),
    )
    DsCard(modifier = modifier.fillMaxWidth(), onClick = onClick) {
        Text(text = stringResource(R.string.core_week_title), style = DisciplineTheme.typography.titleMedium, color = colors.textPrimary)
        Text(text = summary, style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
        Spacer(Modifier.height(14.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(96.dp)
                .semantics(mergeDescendants = true) { contentDescription = summary },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            days.forEach { day ->
                WeekBar(day = day, isToday = day.date == today, label = Formatters.narrowDay(day.date.dayOfWeek, locale), modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun WeekBar(day: DayStat, isToday: Boolean, label: String, modifier: Modifier = Modifier) {
    val colors = DisciplineTheme.colors
    val motion = DisciplineTheme.motion
    val ratio = if (day.total == 0) 0f else day.completed.toFloat() / day.total
    val animated by animateFloatAsState(
        targetValue = ratio,
        animationSpec = tween(motion.duration(motion.longMillis), easing = FastOutSlowInEasing),
        label = "weekBar",
    )
    val barColor = when {
        day.total == 0 -> colors.outline
        day.mandatoryTotal > 0 && day.mandatoryCompleted == day.mandatoryTotal -> colors.success
        else -> colors.primary
    }
    Column(modifier = modifier.fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .weight(1f)
                .width(14.dp)
                .clip(RoundedCornerShape(50))
                .background(colors.surfaceSunken),
            contentAlignment = Alignment.BottomCenter,
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(animated.coerceAtLeast(if (day.total > 0) 0.06f else 0f))
                    .clip(RoundedCornerShape(50))
                    .background(barColor),
            )
        }
        Spacer(Modifier.height(4.dp))
        Text(
            text = label,
            style = DisciplineTheme.typography.labelSmall,
            color = if (isToday) colors.primarySoft else colors.textMuted,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
internal fun IconBubble(icon: ImageVector, tint: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(44.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(tint.copy(alpha = 0.16f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(24.dp))
    }
}

@Composable
internal fun SectionLabel(text: String, count: Int, accent: Color, modifier: Modifier = Modifier) {
    val colors = DisciplineTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 8.dp, bottom = 4.dp)
            .semantics(mergeDescendants = true) { heading() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(accent))
        Spacer(Modifier.width(8.dp))
        Text(text = text, style = DisciplineTheme.typography.titleMedium, color = colors.textPrimary, modifier = Modifier.weight(1f))
        Text(text = count.toString(), style = DisciplineTheme.typography.labelLarge, color = colors.textSecondary)
    }
}

@DsPreviews
@Composable
private fun DashboardCardsPreview() {
    DsPreviewSurface {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            BlockerStatusCard(status = BlockerStatus.Active(3, focusDriven = false), zone = ZoneId.of("Asia/Jerusalem"), onClick = {})
            PlayerProgressCard(
                progress = PlayerProgress(totalXp = 1240, level = 6, xpIntoLevel = 140, xpForNextLevel = 400, currentStreakDays = 12, bestStreakDays = 20, streakFreezesAvailable = 1),
                onClick = {},
            )
            FocusQuickCard(focus = FocusState(), zone = ZoneId.of("Asia/Jerusalem"), onStart = {}, onOpen = {})
            FocusQuickCard(
                focus = FocusState(phase = FocusPhase.WORK, phaseEndsAt = Instant.parse("2026-11-04T12:25:00Z")),
                zone = ZoneId.of("Asia/Jerusalem"),
                onStart = {},
                onOpen = {},
            )
            CoachCard(onClick = {})
            DsSecondaryButton(text = "דוגמה", onClick = {})
        }
    }
}
