package com.disciplineos.app.ui.common

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import kotlinx.coroutines.delay

/** Readable content column on tablets/foldables (content is centered beyond this width). */
val ContentMaxWidth: Dp = 640.dp

/**
 * Side padding that keeps content at most [ContentMaxWidth] wide and centered, while letting the
 * scroll container stay full-screen (so scrolling works from the margins on large screens).
 */
fun horizontalGutter(availableWidth: Dp, minGutter: Dp = 16.dp): Dp =
    maxOf(minGutter, (availableWidth - ContentMaxWidth) / 2)

/**
 * Fades and lifts [content] in after `index * 55ms`. With reduce-motion on, or when [enabled] is
 * false (e.g. the item scrolled into view later), it is shown immediately.
 */
@Composable
fun StaggeredItem(
    index: Int,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val motion = DisciplineTheme.motion
    val animate = enabled && !motion.reduceMotion
    val progress = remember { Animatable(if (animate) 0f else 1f) }
    val liftPx = with(LocalDensity.current) { 18.dp.toPx() }
    LaunchedEffect(animate) {
        if (animate && progress.value < 1f) {
            delay(index.coerceAtMost(10) * 55L)
            progress.animateTo(1f, tween(motion.mediumMillis + 120, easing = FastOutSlowInEasing))
        } else {
            progress.snapTo(1f)
        }
    }
    Box(
        modifier = modifier.graphicsLayer {
            alpha = progress.value
            translationY = (1f - progress.value) * liftPx
        },
    ) {
        content()
    }
}
