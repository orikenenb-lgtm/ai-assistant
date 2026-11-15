package ai.noa.bridge.app.ui.settings

import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.components.BulletLine
import ai.noa.bridge.app.ui.components.ConfirmDialog
import ai.noa.bridge.app.ui.theme.NoaStatus
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Full disclosure shown BEFORE cloud consent can be turned on. */
@Composable
fun ConsentDisclosureDialog(onAgree: () -> Unit, onDecline: () -> Unit) {
    ConfirmDialog(
        title = stringResource(R.string.consent_dialog_title),
        body = stringResource(R.string.consent_dialog_intro),
        confirmLabel = stringResource(R.string.consent_dialog_confirm),
        dismissLabel = stringResource(R.string.consent_dialog_decline),
        onConfirm = onAgree,
        onDismiss = onDecline,
        modifier = Modifier.testTag("consentDialog"),
    ) {
        DisclosureSection(stringResource(R.string.consent_dialog_what_title), stringResource(R.string.consent_dialog_what_body))
        DisclosureSection(stringResource(R.string.consent_dialog_where_title), stringResource(R.string.consent_dialog_where_body))
        DisclosureSection(stringResource(R.string.consent_dialog_control_title), stringResource(R.string.consent_dialog_control_body))
    }
}

@Composable
private fun DisclosureSection(title: String, body: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
        Text(body, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Strong warning shown BEFORE the experimental send path can be turned on. */
@Composable
fun SendingWarningDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val warn = NoaStatus.colors.warning
    ConfirmDialog(
        title = stringResource(R.string.sending_dialog_title),
        body = stringResource(R.string.sending_dialog_body),
        confirmLabel = stringResource(R.string.sending_dialog_confirm),
        onConfirm = onConfirm,
        onDismiss = onDismiss,
        destructive = true,
        modifier = Modifier.testTag("sendingDialog"),
    ) {
        BulletLine(stringResource(R.string.sending_dialog_point_unverified), icon = Icons.Filled.Warning, tint = warn)
        BulletLine(stringResource(R.string.sending_dialog_point_approval), icon = Icons.Filled.Warning, tint = warn)
        BulletLine(stringResource(R.string.sending_dialog_point_delivery), icon = Icons.Filled.Warning, tint = warn)
        BulletLine(stringResource(R.string.sending_dialog_point_once), icon = Icons.Filled.Warning, tint = warn)
    }
}
