package com.disciplineos.app.designsystem.component

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import kotlin.math.roundToInt

/**
 * Animated circular progress. The arc grows from 12 o'clock in the reading direction (clockwise in
 * LTR, counter-clockwise in RTL). Animation is skipped when reduce-motion is on.
 */
@Composable
fun DsProgressRing(
    progress: Float,
    modifier: Modifier = Modifier,
    size: Dp = 120.dp,
    stroke: Dp = 12.dp,
    color: Color = DisciplineTheme.colors.primary,
    trackColor: Color = DisciplineTheme.colors.surfaceSunken,
    content: @Composable () -> Unit = {},
) {
    val motion = DisciplineTheme.motion
    val target = progress.coerceIn(0f, 1f).takeUnless { it.isNaN() } ?: 0f
    val animated by animateFloatAsState(
        targetValue = target,
        animationSpec = tween(durationMillis = motion.duration(motion.longMillis + 300), easing = FastOutSlowInEasing),
        label = "progressRing",
    )
    val direction = if (LocalLayoutDirection.current == LayoutDirection.Rtl) -1f else 1f
    val percent = (target * 100).roundToInt()
    val description = stringResource(R.string.core_cd_progress, percent)
    Box(
        modifier = modifier
            .size(size)
            .semantics {
                contentDescription = description
                progressBarRangeInfo = ProgressBarRangeInfo(target, 0f..1f)
            },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val strokePx = stroke.toPx()
            val inset = strokePx / 2f
            val arcSize = Size(this.size.width - strokePx, this.size.height - strokePx)
            val topLeft = Offset(inset, inset)
            drawArc(
                color = trackColor,
                startAngle = 0f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = strokePx),
            )
            if (animated > 0f) {
                // Soft glow under the arc for depth.
                drawArc(
                    color = color.copy(alpha = 0.18f),
                    startAngle = -90f,
                    sweepAngle = 360f * animated * direction,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokePx * 1.9f, cap = StrokeCap.Round),
                )
                drawArc(
                    color = color,
                    startAngle = -90f,
                    sweepAngle = 360f * animated * direction,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokePx, cap = StrokeCap.Round),
                )
            }
        }
        content()
    }
}

/** Animated horizontal bar. Fills from the start edge, so it mirrors automatically in RTL. */
@Composable
fun DsLinearProgress(
    progress: Float,
    modifier: Modifier = Modifier,
    color: Color = DisciplineTheme.colors.primary,
) {
    val colors = DisciplineTheme.colors
    val motion = DisciplineTheme.motion
    val target = progress.coerceIn(0f, 1f).takeUnless { it.isNaN() } ?: 0f
    val animated by animateFloatAsState(
        targetValue = target,
        animationSpec = tween(durationMillis = motion.duration(motion.longMillis), easing = FastOutSlowInEasing),
        label = "linearProgress",
    )
    val description = stringResource(R.string.core_cd_progress, (target * 100).roundToInt())
    val shape = RoundedCornerShape(50)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(8.dp)
            .clip(shape)
            .background(colors.surfaceSunken)
            .semantics {
                contentDescription = description
                progressBarRangeInfo = ProgressBarRangeInfo(target, 0f..1f)
            },
    ) {
        if (animated > 0f) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(animated)
                    .clip(shape)
                    .background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.75f), color))),
            )
        }
    }
}

@DsPreviews
@Composable
private fun ProgressPreview() {
    DsPreviewSurface {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            DsProgressRing(progress = 0.65f, size = 140.dp) {
                Text("65%", style = DisciplineTheme.typography.headlineMedium, color = DisciplineTheme.colors.textPrimary)
            }
            DsLinearProgress(progress = 0.4f, color = DisciplineTheme.colors.success)
            DsLinearProgress(progress = 0.8f, color = DisciplineTheme.colors.mandatory)
        }
    }
}
