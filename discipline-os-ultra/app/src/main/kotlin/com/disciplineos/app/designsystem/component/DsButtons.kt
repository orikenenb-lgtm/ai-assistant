package com.disciplineos.app.designsystem.component

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.designsystem.theme.accentFill

/** Filled, gradient call-to-action. Shows a spinner and ignores taps while [loading]. */
@Composable
fun DsPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
) {
    val colors = DisciplineTheme.colors
    val base = colors.primary.accentFill()
    val brush = if (enabled) {
        Brush.horizontalGradient(listOf(base, lerp(base, colors.xp.accentFill(), 0.35f)))
    } else {
        Brush.horizontalGradient(listOf(colors.surfaceRaised, colors.surfaceRaised))
    }
    val loadingLabel = stringResource(R.string.core_loading)
    DsButtonFrame(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.semantics { if (loading) stateDescription = loadingLabel },
        background = brush,
        border = null,
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                color = Color.White,
                strokeWidth = 2.5.dp,
            )
            Spacer(Modifier.width(10.dp))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(
            text = text,
            style = DisciplineTheme.typography.labelLarge,
            color = if (enabled) Color.White else colors.textMuted,
            textAlign = TextAlign.Center,
        )
    }
}

/** Outlined, lower-emphasis action. */
@Composable
fun DsSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    val colors = DisciplineTheme.colors
    val content = if (enabled) colors.primarySoft else colors.textMuted
    DsButtonFrame(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        background = Brush.verticalGradient(listOf(colors.surfaceRaised.copy(alpha = 0.55f), colors.surface.copy(alpha = 0.55f))),
        border = BorderStroke(1.dp, if (enabled) colors.primary.copy(alpha = 0.7f) else colors.outline),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text = text, style = DisciplineTheme.typography.labelLarge, color = content, textAlign = TextAlign.Center)
    }
}

/** Destructive action (delete, archive). Pair with [DsConfirmDialog]. */
@Composable
fun DsDangerButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = DisciplineTheme.colors
    val fill = colors.danger.accentFill()
    DsButtonFrame(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        background = if (enabled) Brush.verticalGradient(listOf(fill, fill)) else Brush.verticalGradient(listOf(colors.surfaceRaised, colors.surfaceRaised)),
        border = null,
    ) {
        Text(
            text = text,
            style = DisciplineTheme.typography.labelLarge,
            color = if (enabled) Color.White else colors.textMuted,
            textAlign = TextAlign.Center,
        )
    }
}

/** Shared frame: 52dp min height (≥ 48dp target), press-scale feedback that honours reduce-motion. */
@Composable
private fun DsButtonFrame(
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier,
    background: Brush,
    border: BorderStroke?,
    content: @Composable () -> Unit,
) {
    val motion = DisciplineTheme.motion
    val shape: Shape = RoundedCornerShape(DisciplineTheme.shapes.buttonRadius)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && !motion.reduceMotion) 0.97f else 1f,
        animationSpec = tween(motion.duration(motion.shortMillis)),
        label = "buttonPress",
    )
    Box(
        modifier = modifier
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .heightIn(min = 52.dp)
            .clip(shape)
            .background(background)
            .then(if (border != null) Modifier.border(border, shape) else Modifier)
            .clickable(
                interactionSource = interaction,
                indication = LocalIndication.current,
                enabled = enabled,
                role = Role.Button,
                onClick = onClick,
            )
            .padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            content()
        }
    }
}

@DsPreviews
@Composable
private fun ButtonsPreview() {
    DsPreviewSurface {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DsPrimaryButton(text = "צור משימה", onClick = {}, icon = Icons.Filled.Add, modifier = Modifier.fillMaxWidth())
            DsPrimaryButton(text = "שומר", onClick = {}, loading = true, modifier = Modifier.fillMaxWidth())
            DsSecondaryButton(text = "התחל מיקוד", onClick = {}, icon = Icons.Filled.Bolt, modifier = Modifier.fillMaxWidth())
            DsDangerButton(text = "מחק", onClick = {}, modifier = Modifier.fillMaxWidth())
            DsPrimaryButton(text = "לא זמין", onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth())
        }
    }
}
