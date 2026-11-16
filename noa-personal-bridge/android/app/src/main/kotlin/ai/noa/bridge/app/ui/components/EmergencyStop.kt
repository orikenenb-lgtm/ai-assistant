package ai.noa.bridge.app.ui.components

import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.theme.NoaStatus
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * UX-03: a compact emergency-stop action for top app bars, so the stop is always one tap (plus the
 * confirmation) away without scrolling. Uses the same confirmation dialog as the big Home button.
 * While already stopped it stays visible but disabled ("עצירת חירום פעילה").
 */
@Composable
fun EmergencyStopAction(stopped: Boolean, onStop: () -> Unit, modifier: Modifier = Modifier) {
    var confirm by rememberSaveable { mutableStateOf(false) }
    val danger = NoaStatus.colors.danger
    val cd = stringResource(if (stopped) R.string.cd_emergency_stop_active else R.string.cd_emergency_stop_action)
    TextButton(
        onClick = { confirm = true },
        enabled = !stopped,
        colors = ButtonDefaults.textButtonColors(contentColor = danger),
        modifier = modifier
            .heightIn(min = MinTouchTarget)
            .semantics(mergeDescendants = true) { contentDescription = cd }
            .testTag("topEmergencyStop"),
    ) {
        Icon(painterResource(R.drawable.ic_emergency_stop), contentDescription = null, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(4.dp))
        Text(stringResource(R.string.home_emergency_stop_short), fontWeight = FontWeight.Bold)
    }
    if (confirm) {
        EmergencyStopDialog(
            onConfirm = {
                confirm = false
                onStop()
            },
            onDismiss = { confirm = false },
        )
    }
}

@Composable
fun EmergencyStopDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    ConfirmDialog(
        title = stringResource(R.string.home_emergency_dialog_title),
        body = stringResource(R.string.home_emergency_dialog_body),
        confirmLabel = stringResource(R.string.home_emergency_dialog_confirm),
        destructive = true,
        onConfirm = onConfirm,
        onDismiss = onDismiss,
    )
}
