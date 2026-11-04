package com.disciplineos.app.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.theme.DisciplineTheme

/** Friendly empty screen/section with an optional call to action. */
@Composable
fun DsEmptyState(
    title: String,
    message: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val colors = DisciplineTheme.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(88.dp)
                .clip(CircleShape)
                .background(
                    Brush.radialGradient(listOf(colors.primary.copy(alpha = 0.32f), colors.primary.copy(alpha = 0.04f))),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = colors.primarySoft, modifier = Modifier.size(40.dp))
        }
        Spacer(Modifier.height(20.dp))
        Text(
            text = title,
            style = DisciplineTheme.typography.titleLarge,
            color = colors.textPrimary,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = message,
            style = DisciplineTheme.typography.bodyMedium,
            color = colors.textSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 420.dp),
        )
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(24.dp))
            DsPrimaryButton(text = actionLabel, onClick = onAction)
        }
    }
}

/** Centered spinner with an optional message; announced politely to screen readers. */
@Composable
fun DsLoadingState(
    modifier: Modifier = Modifier,
    message: String? = null,
) {
    val colors = DisciplineTheme.colors
    val description = message ?: stringResource(R.string.core_loading)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(32.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = description
                liveRegion = LiveRegionMode.Polite
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(color = colors.primary, trackColor = colors.surfaceSunken, strokeWidth = 4.dp)
        if (message != null) {
            Spacer(Modifier.height(16.dp))
            Text(text = message, style = DisciplineTheme.typography.bodyMedium, color = colors.textSecondary, textAlign = TextAlign.Center)
        }
    }
}

/** Error with a human message and optional retry. */
@Composable
fun DsErrorState(
    message: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    val colors = DisciplineTheme.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 32.dp)
            .semantics { liveRegion = LiveRegionMode.Assertive },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(colors.danger.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = colors.danger, modifier = Modifier.size(36.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.core_error_title),
            style = DisciplineTheme.typography.titleMedium,
            color = colors.textPrimary,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = message,
            style = DisciplineTheme.typography.bodyMedium,
            color = colors.textSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 420.dp),
        )
        if (onRetry != null) {
            Spacer(Modifier.height(20.dp))
            DsSecondaryButton(text = stringResource(R.string.core_retry), onClick = onRetry, icon = Icons.Filled.Refresh)
        }
    }
}

@DsPreviews
@Composable
private fun StatesPreview() {
    DsPreviewSurface {
        Column {
            DsEmptyState(
                title = "אין משימות להיום",
                message = "צור משימה ראשונה כדי להתחיל לבנות רצף.",
                icon = Icons.Outlined.TaskAlt,
                actionLabel = "צור משימה",
                onAction = {},
            )
            DsLoadingState(message = "טוען את היום שלך…")
            DsErrorState(message = "לא הצלחנו לטעון את הנתונים.", onRetry = {})
        }
    }
}
