package com.disciplineos.app.ui.stats

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.disciplineos.app.designsystem.theme.DisciplineTheme

/**
 * Stacked "completed / total" bar chart. Bars follow reading direction (oldest at the start edge),
 * so in RTL the newest day is on the left. The whole chart exposes a single Hebrew summary to TalkBack.
 */
@Composable
fun CompletionBarChart(
    buckets: List<ChartBucket>,
    contentDescription: String,
    modifier: Modifier = Modifier,
    height: Dp = 160.dp,
) {
    val colors = DisciplineTheme.colors
    val axisMax = ChartMath.niceMax(buckets.maxOfOrNull { maxOf(it.total, it.value) } ?: 0)
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Column(modifier.clearAndSetSemantics { this.contentDescription = contentDescription }) {
        val track = colors.surfaceSunken
        val done = colors.success
        val grid = colors.outline
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(height),
        ) {
            if (buckets.isEmpty()) return@Canvas
            // Grid lines at 0, 50%, 100%.
            listOf(0f, 0.5f, 1f).forEach { f ->
                val y = size.height - f * size.height
                drawLine(
                    color = grid,
                    start = Offset(0f, y),
                    end = Offset(size.width, y),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)),
                )
            }
            val slot = size.width / buckets.size
            val barWidth = (slot * 0.6f).coerceAtMost(28.dp.toPx())
            val radius = CornerRadius(barWidth / 3f, barWidth / 3f)
            buckets.forEachIndexed { i, b ->
                val slotIndex = if (rtl) buckets.size - 1 - i else i
                val left = slotIndex * slot + (slot - barWidth) / 2f
                val totalH = ChartMath.fraction(b.total, axisMax) * size.height
                val doneH = ChartMath.fraction(b.value, axisMax) * size.height
                if (totalH > 0f) {
                    drawRoundRect(
                        color = track,
                        topLeft = Offset(left, size.height - totalH),
                        size = Size(barWidth, totalH),
                        cornerRadius = radius,
                    )
                }
                if (doneH > 0f) {
                    drawRoundRect(
                        color = done,
                        topLeft = Offset(left, size.height - doneH),
                        size = Size(barWidth, doneH),
                        cornerRadius = radius,
                    )
                }
            }
        }
        AxisLabels(buckets.map { it.label })
    }
}

/** Smooth-ish line chart with area fill for focus minutes. */
@Composable
fun FocusLineChart(
    buckets: List<ChartBucket>,
    contentDescription: String,
    modifier: Modifier = Modifier,
    height: Dp = 140.dp,
) {
    val colors = DisciplineTheme.colors
    val values = buckets.map { it.value }
    val axisMax = ChartMath.niceMax(values.maxOrNull() ?: 0)
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Column(modifier.clearAndSetSemantics { this.contentDescription = contentDescription }) {
        val line = colors.primary
        val fillTop = colors.primary.copy(alpha = 0.35f)
        val grid = colors.outline
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(height),
        ) {
            if (values.isEmpty()) return@Canvas
            val pad = 6.dp.toPx()
            val w = size.width - pad * 2
            val h = size.height - pad * 2
            drawLine(grid, Offset(0f, size.height - pad), Offset(size.width, size.height - pad), strokeWidth = 1.dp.toPx())
            // Points are centred in the same slots as the axis labels below.
            val slot = size.width / values.size
            val pts = ChartMath.linePoints(values, w, h, axisMax, rtl = false).mapIndexed { i, p ->
                val slotIndex = if (rtl) values.size - 1 - i else i
                Offset(slotIndex * slot + slot / 2f, p.y + pad)
            }
            val path = Path().apply {
                pts.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) }
            }
            if (pts.size > 1) {
                val area = Path().apply {
                    addPath(path)
                    lineTo(pts.last().x, size.height - pad)
                    lineTo(pts.first().x, size.height - pad)
                    close()
                }
                drawPath(area, Brush.verticalGradient(listOf(fillTop, Color.Transparent)))
                drawPath(path, line, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            pts.forEach { p -> drawCircle(line, radius = 3.5.dp.toPx(), center = p) }
        }
        AxisLabels(buckets.map { it.label })
    }
}

data class DonutSlice(val label: String, val value: Int, val color: Color)

/** Donut chart with a legend. */
@Composable
fun CategoryDonut(
    slices: List<DonutSlice>,
    contentDescription: String,
    modifier: Modifier = Modifier,
    size: Dp = 140.dp,
) {
    val sweeps = ChartMath.donutSweeps(slices.map { it.value })
    val track = DisciplineTheme.colors.surfaceSunken
    Row(
        modifier = modifier.clearAndSetSemantics { this.contentDescription = contentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.lg),
    ) {
        Canvas(Modifier.size(size)) {
            val stroke = 22.dp.toPx()
            val inset = stroke / 2f
            val arcSize = Size(this.size.width - stroke, this.size.height - stroke)
            val topLeft = Offset(inset, inset)
            drawArc(track, 0f, 360f, false, topLeft, arcSize, style = Stroke(stroke))
            var start = -90f
            slices.forEachIndexed { i, slice ->
                val sweep = sweeps[i]
                if (sweep > 0f) {
                    // Small gap between slices for legibility (only when there is more than one slice).
                    val gap = if (sweeps.count { it > 0f } > 1) 2f else 0f
                    drawArc(slice.color, start + gap / 2f, (sweep - gap).coerceAtLeast(0.5f), false, topLeft, arcSize, style = Stroke(stroke))
                }
                start += sweep
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(DisciplineTheme.spacing.xs), modifier = Modifier.weight(1f)) {
            slices.forEach { slice ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(slice.color),
                    )
                    Spacer(Modifier.width(DisciplineTheme.spacing.sm))
                    Text(
                        text = slice.label,
                        style = MaterialTheme.typography.bodyMedium,
                        color = DisciplineTheme.colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = slice.value.toString(),
                        style = MaterialTheme.typography.labelLarge,
                        color = DisciplineTheme.colors.textSecondary,
                    )
                }
            }
        }
    }
}

/** Labels laid out in a Row, which mirrors automatically in RTL — matching the mirrored bar order. */
@Composable
private fun AxisLabels(labels: List<String>) {
    if (labels.isEmpty()) return
    // Thin out labels when there are many so they never overlap.
    val every = if (labels.size > 10) (labels.size + 6) / 7 else 1
    Row(Modifier.fillMaxWidth()) {
        labels.forEachIndexed { i, label ->
            Text(
                text = if (i % every == 0) label else "",
                style = MaterialTheme.typography.labelSmall,
                color = DisciplineTheme.colors.textMuted,
                textAlign = TextAlign.Center,
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
        }
    }
}
