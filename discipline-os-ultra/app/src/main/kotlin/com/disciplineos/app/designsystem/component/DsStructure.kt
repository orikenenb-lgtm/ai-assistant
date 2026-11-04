package com.disciplineos.app.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.theme.DisciplineTheme

/** Section title (announced as a heading) with an optional trailing text action. */
@Composable
fun DsSectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val colors = DisciplineTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = DisciplineTheme.spacing.minTouch),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = DisciplineTheme.typography.titleMedium,
            color = colors.textPrimary,
            modifier = Modifier
                .weight(1f)
                .semantics { heading() },
        )
        if (actionLabel != null && onAction != null) {
            TextButton(onClick = onAction, modifier = Modifier.heightIn(min = DisciplineTheme.spacing.minTouch)) {
                Text(text = actionLabel, style = DisciplineTheme.typography.labelLarge, color = colors.primarySoft)
            }
        }
    }
}

/**
 * Generic list row. When clickable and no [trailing] is provided, shows a direction-aware chevron.
 * Minimum height 56dp; whole row is one accessible node.
 */
@Composable
fun DsListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    leadingIcon: ImageVector? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    val colors = DisciplineTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(RoundedCornerShape(DisciplineTheme.shapes.chipRadius))
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier.semantics(mergeDescendants = true) {})
            .padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leadingIcon != null) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(colors.surfaceRaised),
                contentAlignment = Alignment.Center,
            ) {
                Icon(leadingIcon, contentDescription = null, tint = colors.primarySoft, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(14.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = DisciplineTheme.typography.bodyLarge, color = colors.textPrimary)
            if (subtitle != null) {
                Text(text = subtitle, style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
            }
        }
        if (trailing != null) {
            Spacer(Modifier.width(8.dp))
            trailing()
        } else if (onClick != null) {
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = colors.textMuted,
            )
        }
    }
}

/**
 * Screen top bar. Applies the status-bar inset itself, so use it as `Scaffold(topBar = { DsTopBar(...) })`.
 * The back arrow is auto-mirrored (points right in RTL).
 */
@Composable
fun DsTopBar(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val colors = DisciplineTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.background)
            .windowInsetsPadding(WindowInsets.statusBars.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .heightIn(min = 64.dp)
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.core_cd_back),
                    tint = colors.textPrimary,
                )
            }
        } else {
            Spacer(Modifier.width(12.dp))
        }
        Text(
            text = title,
            style = DisciplineTheme.typography.titleLarge,
            color = colors.textPrimary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 4.dp)
                .semantics { heading() },
        )
        Row(verticalAlignment = Alignment.CenterVertically, content = actions)
    }
}

/** Confirmation dialog. [destructive] colors the confirm action red. */
@Composable
fun DsConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    dismissLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
) {
    val colors = DisciplineTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(text = title, style = DisciplineTheme.typography.titleLarge, color = colors.textPrimary) },
        text = { Text(text = message, style = DisciplineTheme.typography.bodyMedium, color = colors.textSecondary) },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.heightIn(min = DisciplineTheme.spacing.minTouch)) {
                Text(
                    text = confirmLabel,
                    style = DisciplineTheme.typography.labelLarge,
                    color = if (destructive) colors.danger else colors.primarySoft,
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = DisciplineTheme.spacing.minTouch)) {
                Text(text = dismissLabel, style = DisciplineTheme.typography.labelLarge, color = colors.textSecondary)
            }
        },
        containerColor = colors.surface,
        shape = RoundedCornerShape(DisciplineTheme.shapes.sheetRadius),
    )
}

@DsPreviews
@Composable
private fun StructurePreview() {
    DsPreviewSurface {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            DsTopBar(title = "פרטי משימה", onBack = {}, actions = {
                IconButton(onClick = {}) { Icon(Icons.Filled.MoreVert, contentDescription = "עוד") }
            })
            DsSectionHeader(title = "משימות חובה", actionLabel = "הכל", onAction = {})
            DsListRow(title = "התראות", subtitle = "תזכורות למשימות", leadingIcon = Icons.Outlined.Notifications, onClick = {})
        }
    }
}
