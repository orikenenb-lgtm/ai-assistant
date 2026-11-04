package com.disciplineos.app.designsystem.component

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.disciplineos.app.designsystem.theme.DisciplineTheme

/**
 * Elevated surface: 20dp corners, a subtle top-lit gradient and a hairline border. When [onClick] is
 * set the whole card is one accessible button (children are merged for TalkBack) with press feedback.
 */
@Composable
fun DsCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    contentPadding: PaddingValues = PaddingValues(16.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = DisciplineTheme.colors
    val motion = DisciplineTheme.motion
    val shape = RoundedCornerShape(DisciplineTheme.shapes.cardRadius)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && onClick != null && !motion.reduceMotion) 0.985f else 1f,
        animationSpec = tween(motion.duration(motion.shortMillis)),
        label = "cardPress",
    )
    Column(
        modifier = modifier
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .clip(shape)
            .background(
                Brush.verticalGradient(
                    listOf(lerp(colors.surface, colors.surfaceRaised, 0.55f), colors.surface),
                ),
            )
            .border(1.dp, colors.outline.copy(alpha = 0.55f), shape)
            .then(
                if (onClick != null) {
                    Modifier.clickable(
                        interactionSource = interaction,
                        indication = LocalIndication.current,
                        role = Role.Button,
                        onClick = onClick,
                    )
                } else {
                    Modifier
                },
            )
            .padding(contentPadding),
        content = content,
    )
}

/** Compact pill label (e.g. "חובה", "באיחור"). Text is lightened toward white for legibility. */
@Composable
fun DsBadge(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(color.copy(alpha = 0.16f))
            .border(1.dp, color.copy(alpha = 0.45f), RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 3.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = DisciplineTheme.typography.labelMedium,
            color = lerp(color, Color.White, 0.3f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Metric tile: icon, big value, label and optional caption. Read as one node by TalkBack. */
@Composable
fun DsStatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    accent: Color = DisciplineTheme.colors.primary,
    caption: String? = null,
) {
    val colors = DisciplineTheme.colors
    DsCard(modifier = modifier.semantics(mergeDescendants = true) {}, contentPadding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(accent.copy(alpha = 0.18f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(18.dp))
                }
                Spacer(Modifier.size(8.dp))
            }
            Text(
                text = label,
                style = DisciplineTheme.typography.labelMedium,
                color = colors.textSecondary,
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(text = value, style = DisciplineTheme.typography.headlineSmall, color = colors.textPrimary)
        if (caption != null) {
            Spacer(Modifier.height(2.dp))
            Text(text = caption, style = DisciplineTheme.typography.bodySmall, color = colors.textMuted)
        }
    }
}

@DsPreviews
@Composable
private fun CardsPreview() {
    DsPreviewSurface {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DsCard(onClick = {}) {
                Text("כרטיס לחיץ", style = DisciplineTheme.typography.titleMedium, color = DisciplineTheme.colors.textPrimary)
                Text("תוכן משני של הכרטיס", style = DisciplineTheme.typography.bodyMedium, color = DisciplineTheme.colors.textSecondary)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                DsStatTile(
                    label = "רצף",
                    value = "12 ימים",
                    icon = Icons.Filled.LocalFireDepartment,
                    accent = DisciplineTheme.colors.warning,
                    caption = "שיא: 20",
                    modifier = Modifier.weight(1f),
                )
                DsStatTile(
                    label = "מיקוד",
                    value = "95 דק׳",
                    icon = Icons.Filled.Timer,
                    modifier = Modifier.weight(1f),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DsBadge(text = "חובה", color = DisciplineTheme.colors.mandatory)
                DsBadge(text = "רשות", color = DisciplineTheme.colors.optional)
                DsBadge(text = "הושלם", color = DisciplineTheme.colors.success)
            }
        }
    }
}
