package com.disciplineos.app.ui.navigation

import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.theme.DisciplineTheme

private data class BottomItem(
    @StringRes val label: Int,
    val selectedIcon: ImageVector,
    val icon: ImageVector,
)

private fun TopLevelDestination.item(): BottomItem = when (this) {
    TopLevelDestination.DASHBOARD -> BottomItem(R.string.core_nav_home, Icons.Filled.Home, Icons.Outlined.Home)
    TopLevelDestination.TASKS -> BottomItem(R.string.core_nav_tasks, Icons.Filled.TaskAlt, Icons.Outlined.TaskAlt)
    TopLevelDestination.FOCUS -> BottomItem(R.string.core_nav_focus, Icons.Filled.Timer, Icons.Outlined.Timer)
    TopLevelDestination.STATS -> BottomItem(R.string.core_nav_stats, Icons.Filled.Insights, Icons.Outlined.Insights)
    TopLevelDestination.SETTINGS -> BottomItem(R.string.core_nav_settings, Icons.Filled.Settings, Icons.Outlined.Settings)
}

/**
 * Bottom navigation for [TopLevelDestination]. Items are laid out in display order and mirror
 * automatically in RTL (home sits at the right edge in Hebrew). Hidden on non-top-level screens.
 */
@Composable
fun DisciplineBottomBar(
    visible: Boolean,
    current: TopLevelDestination?,
    onSelect: (TopLevelDestination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = DisciplineTheme.colors
    val motion = DisciplineTheme.motion
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = expandVertically(tween(motion.duration(motion.mediumMillis))) + fadeIn(tween(motion.duration(motion.mediumMillis))),
        exit = shrinkVertically(tween(motion.duration(motion.shortMillis))) + fadeOut(tween(motion.duration(motion.shortMillis))),
    ) {
        Column {
            HorizontalDivider(color = colors.outline.copy(alpha = 0.5f))
            NavigationBar(
                containerColor = colors.surfaceSunken,
                contentColor = colors.textSecondary,
                tonalElevation = 0.dp,
            ) {
                TopLevelDestination.entries.forEach { destination ->
                    val item = destination.item()
                    val selected = destination == current
                    NavigationBarItem(
                        selected = selected,
                        onClick = { onSelect(destination) },
                        icon = {
                            Icon(
                                imageVector = if (selected) item.selectedIcon else item.icon,
                                contentDescription = null,
                            )
                        },
                        label = {
                            Text(
                                text = stringResource(item.label),
                                style = DisciplineTheme.typography.labelMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = colors.primarySoft,
                            selectedTextColor = colors.textPrimary,
                            indicatorColor = colors.primary.copy(alpha = 0.2f),
                            unselectedIconColor = colors.textSecondary,
                            unselectedTextColor = colors.textSecondary,
                        ),
                    )
                }
            }
        }
    }
}
