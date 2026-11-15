package ai.noa.bridge.app.ui.components

import ai.noa.bridge.app.ui.theme.NoaStatus
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ai.noa.bridge.app.R

/** Minimum touch target, per Material / WCAG 2.5.5. */
val MinTouchTarget = 48.dp

@Composable
fun SectionHeader(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = modifier
            .padding(top = 8.dp, bottom = 4.dp)
            .semantics { heading() },
    )
}

@Composable
fun ScreenTitle(text: String, modifier: Modifier = Modifier, subtitle: String? = null) {
    Column(modifier.padding(vertical = 8.dp)) {
        Text(
            text = text,
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
        if (subtitle != null) {
            Spacer(Modifier.padding(top = 4.dp))
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

enum class StatusLevel { OK, ATTENTION, PROBLEM, NEUTRAL }

@Composable
private fun levelColors(level: StatusLevel): Pair<Color, Color> {
    val s = NoaStatus.colors
    return when (level) {
        StatusLevel.OK -> s.successContainer to s.onSuccessContainer
        StatusLevel.ATTENTION -> s.warningContainer to s.onWarningContainer
        StatusLevel.PROBLEM -> s.dangerContainer to s.onDangerContainer
        StatusLevel.NEUTRAL -> MaterialTheme.colorScheme.surfaceContainerHigh to MaterialTheme.colorScheme.onSurfaceVariant
    }
}

private fun levelIcon(level: StatusLevel): ImageVector = when (level) {
    StatusLevel.OK -> Icons.Filled.CheckCircle
    StatusLevel.ATTENTION, StatusLevel.PROBLEM -> Icons.Filled.Warning
    StatusLevel.NEUTRAL -> Icons.Filled.Info
}

/** Icon + text pill. Status is never conveyed by color alone. */
@Composable
fun StatusPill(level: StatusLevel, label: String, modifier: Modifier = Modifier) {
    val (bg, fg) = levelColors(level)
    Surface(color = bg, contentColor = fg, shape = CircleShape, modifier = modifier) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        ) {
            Icon(levelIcon(level), contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(label, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
fun NoaCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shape = MaterialTheme.shapes.medium,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

/** A status card: title (heading) + status pill + body + optional actions row. */
@Composable
fun StatusCard(
    title: String,
    icon: ImageVector,
    level: StatusLevel,
    statusLabel: String,
    modifier: Modifier = Modifier,
    body: @Composable ColumnScope.() -> Unit = {},
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    NoaCard(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                shape = MaterialTheme.shapes.small,
            ) {
                Icon(icon, contentDescription = null, modifier = Modifier.padding(8.dp).size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            Spacer(Modifier.width(8.dp))
            StatusPill(level, statusLabel)
        }
        body()
        if (actions != null) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.Start),
                verticalAlignment = Alignment.CenterVertically,
                content = actions,
            )
        }
    }
}

enum class BannerKind { INFO, WARNING, DANGER, SUCCESS }

@Composable
fun NoticeBanner(
    kind: BannerKind,
    body: String,
    modifier: Modifier = Modifier,
    title: String? = null,
    /** A11Y-02: set for banners that appear in response to something (errors, results). */
    liveRegion: LiveRegionMode? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val s = NoaStatus.colors
    val (bg, fg) = when (kind) {
        BannerKind.INFO -> s.infoContainer to s.onInfoContainer
        BannerKind.WARNING -> s.warningContainer to s.onWarningContainer
        BannerKind.DANGER -> s.dangerContainer to s.onDangerContainer
        BannerKind.SUCCESS -> s.successContainer to s.onSuccessContainer
    }
    val icon = when (kind) {
        BannerKind.INFO -> Icons.Filled.Info
        BannerKind.SUCCESS -> Icons.Filled.CheckCircle
        else -> Icons.Filled.Warning
    }
    val iconCd = when (kind) {
        BannerKind.INFO -> stringResource(R.string.cd_info)
        BannerKind.SUCCESS -> stringResource(R.string.cd_status_ok)
        BannerKind.WARNING -> stringResource(R.string.cd_warning)
        BannerKind.DANGER -> stringResource(R.string.cd_error)
    }
    val live = if (liveRegion != null) Modifier.semantics { this.liveRegion = liveRegion } else Modifier
    Surface(color = bg, contentColor = fg, shape = MaterialTheme.shapes.medium, modifier = modifier.then(live).fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            Icon(icon, contentDescription = iconCd, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (title != null) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                        modifier = Modifier.semantics { heading() },
                    )
                }
                Text(body, style = MaterialTheme.typography.bodyMedium)
                if (action != null) {
                    Box(Modifier.padding(top = 4.dp)) { action() }
                }
            }
        }
    }
}

/**
 * Confirmation dialog. The body scrolls, so it never clips at 200% font scale.
 * [destructive] renders the confirm action in the danger color. The dismiss action reads "סגור"
 * by default (UX-02: "ביטול" is reserved for cancelling a draft).
 *
 * [filterObscuredTouches] (S-L8, tapjacking): the dialog's window drops touches that arrive while
 * another window is drawn over it (View.filterTouchesWhenObscured on the dialog's own view and its
 * root), in addition to MainActivity hiding non-system overlays on Android 12+.
 */
@Composable
fun ConfirmDialog(
    title: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    body: String? = null,
    dismissLabel: String = stringResource(R.string.action_close),
    destructive: Boolean = false,
    confirmEnabled: Boolean = true,
    filterObscuredTouches: Boolean = false,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val danger = NoaStatus.colors.danger
    AlertDialog(
        modifier = modifier,
        onDismissRequest = onDismiss,
        title = { Text(title, modifier = Modifier.semantics { heading() }) },
        text = {
            if (filterObscuredTouches) FilterObscuredTouches()
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (body != null) Text(body, style = MaterialTheme.typography.bodyMedium)
                content?.invoke(this)
            }
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                enabled = confirmEnabled,
                modifier = Modifier.heightIn(min = MinTouchTarget),
                colors = if (destructive) ButtonDefaults.textButtonColors(contentColor = danger) else ButtonDefaults.textButtonColors(),
            ) { Text(confirmLabel, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = MinTouchTarget)) { Text(dismissLabel) }
        },
    )
}

/** Sets filterTouchesWhenObscured on the hosting (dialog) view and its root while composed. */
@Composable
private fun FilterObscuredTouches() {
    val view = LocalView.current
    DisposableEffect(view) {
        val root = view.rootView
        val before = view.filterTouchesWhenObscured to root.filterTouchesWhenObscured
        view.filterTouchesWhenObscured = true
        root.filterTouchesWhenObscured = true
        onDispose {
            view.filterTouchesWhenObscured = before.first
            root.filterTouchesWhenObscured = before.second
        }
    }
}

/** A bulleted line used in explanations (onboarding, disclosure dialogs). */
@Composable
fun BulletLine(text: String, modifier: Modifier = Modifier, icon: ImageVector = Icons.Filled.CheckCircle, tint: Color = MaterialTheme.colorScheme.primary) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.padding(top = 2.dp).size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}
