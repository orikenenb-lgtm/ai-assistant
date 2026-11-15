package ai.noa.bridge.app.ui.components

import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.theme.NoaStatus
import ai.noa.bridge.core.Draft
import ai.noa.bridge.core.DraftState
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

/** Draft states that are still "in flight" and shown at the top of the list. */
val ActiveStates: Set<DraftState> = setOf(
    DraftState.RECEIVED, DraftState.FILTERED, DraftState.DEBOUNCING, DraftState.PROCESSING,
    DraftState.DRAFT_READY, DraftState.AWAITING_APPROVAL, DraftState.APPROVED, DraftState.SENDING,
)

/** States that count as "waiting for the user" (badge, home card). */
val PendingStates: Set<DraftState> = setOf(DraftState.DRAFT_READY, DraftState.AWAITING_APPROVAL)

/** States in which the user may still edit / approve / cancel. */
val ApprovableStates: Set<DraftState> = setOf(DraftState.DRAFT_READY, DraftState.AWAITING_APPROVAL)

/** States in which a cancel makes sense (nothing has been handed to WhatsApp yet). */
val CancellableStates: Set<DraftState> = setOf(
    DraftState.RECEIVED, DraftState.FILTERED, DraftState.DEBOUNCING, DraftState.PROCESSING,
    DraftState.DRAFT_READY, DraftState.AWAITING_APPROVAL, DraftState.APPROVED,
)

fun List<Draft>.pendingCount(): Int = count { it.state in PendingStates }

@StringRes
fun DraftState.labelRes(): Int = when (this) {
    DraftState.RECEIVED -> R.string.state_received
    DraftState.FILTERED -> R.string.state_filtered
    DraftState.DEBOUNCING -> R.string.state_debouncing
    DraftState.PROCESSING -> R.string.state_processing
    DraftState.DRAFT_READY -> R.string.state_draft_ready
    DraftState.AWAITING_APPROVAL -> R.string.state_awaiting_approval
    DraftState.APPROVED -> R.string.state_approved
    DraftState.SENDING -> R.string.state_sending
    DraftState.SEND_ATTEMPTED -> R.string.state_send_attempted
    DraftState.FAILED -> R.string.state_failed
    DraftState.UNKNOWN_RESULT -> R.string.state_unknown_result
    DraftState.EXPIRED -> R.string.state_expired
    DraftState.CANCELLED -> R.string.state_cancelled
}

@StringRes
fun DraftState.explanationRes(): Int = when (this) {
    DraftState.RECEIVED -> R.string.explain_received
    DraftState.FILTERED -> R.string.explain_filtered
    DraftState.DEBOUNCING -> R.string.explain_debouncing
    DraftState.PROCESSING -> R.string.explain_processing
    DraftState.DRAFT_READY -> R.string.explain_draft_ready
    DraftState.AWAITING_APPROVAL -> R.string.explain_awaiting_approval
    DraftState.APPROVED -> R.string.explain_approved
    DraftState.SENDING -> R.string.explain_sending
    DraftState.SEND_ATTEMPTED -> R.string.explain_send_attempted
    DraftState.FAILED -> R.string.explain_failed
    DraftState.UNKNOWN_RESULT -> R.string.explain_unknown_result
    DraftState.EXPIRED -> R.string.explain_expired
    DraftState.CANCELLED -> R.string.explain_cancelled
}

private data class ChipStyle(val bg: Color, val fg: Color, val icon: ImageVector)

@Composable
private fun chipStyle(state: DraftState): ChipStyle {
    val s = NoaStatus.colors
    val cs = MaterialTheme.colorScheme
    return when (state) {
        DraftState.RECEIVED, DraftState.FILTERED -> ChipStyle(cs.surfaceContainerHigh, cs.onSurfaceVariant, Icons.Filled.Info)
        DraftState.DEBOUNCING -> ChipStyle(cs.surfaceContainerHigh, cs.onSurfaceVariant, Icons.Filled.DateRange)
        DraftState.PROCESSING -> ChipStyle(cs.secondaryContainer, cs.onSecondaryContainer, Icons.Filled.Create)
        DraftState.DRAFT_READY, DraftState.AWAITING_APPROVAL -> ChipStyle(s.infoContainer, s.onInfoContainer, Icons.Filled.Info)
        DraftState.APPROVED -> ChipStyle(s.infoContainer, s.onInfoContainer, Icons.Filled.Check)
        DraftState.SENDING -> ChipStyle(s.infoContainer, s.onInfoContainer, Icons.AutoMirrored.Filled.Send)
        DraftState.SEND_ATTEMPTED -> ChipStyle(s.successContainer, s.onSuccessContainer, Icons.Filled.Done)
        DraftState.FAILED -> ChipStyle(s.dangerContainer, s.onDangerContainer, Icons.Filled.Warning)
        DraftState.UNKNOWN_RESULT -> ChipStyle(s.warningContainer, s.onWarningContainer, Icons.Filled.Refresh)
        DraftState.EXPIRED -> ChipStyle(cs.surfaceContainerHigh, cs.onSurfaceVariant, Icons.Filled.Clear)
        DraftState.CANCELLED -> ChipStyle(cs.surfaceContainerHigh, cs.onSurfaceVariant, Icons.Filled.Clear)
    }
}

/** State chip: icon + Hebrew label (never color-only). Not clickable, so it needs no 48dp target. */
@Composable
fun DraftStateChip(state: DraftState, modifier: Modifier = Modifier) {
    val style = chipStyle(state)
    Surface(
        color = style.bg,
        contentColor = style.fg,
        shape = CircleShape,
        modifier = modifier.testTag("stateChip_${state.name}"),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)) {
            Icon(style.icon, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(state.labelRes()), style = MaterialTheme.typography.labelMedium)
        }
    }
}
