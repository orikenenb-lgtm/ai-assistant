package com.disciplineos.app.enforcement.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsPrimaryButton
import com.disciplineos.app.designsystem.theme.DisciplineTheme

/**
 * Prominent in-app disclosure required BEFORE the user is sent to the system accessibility settings.
 * Consent is explicit (button press), and declining has no consequences: the default mode keeps working.
 */
@Composable
fun AccessibilityDisclosureDialog(
    onAccept: () -> Unit,
    onDecline: () -> Unit,
) {
    val colors = DisciplineTheme.colors
    AlertDialog(
        onDismissRequest = onDecline,
        properties = DialogProperties(dismissOnClickOutside = false),
        containerColor = colors.surface,
        title = {
            Text(
                text = stringResource(R.string.a11y_disclosure_title),
                style = DisciplineTheme.typography.titleLarge,
                color = colors.textPrimary,
            )
        },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                Text(
                    text = stringResource(R.string.a11y_disclosure_body),
                    style = DisciplineTheme.typography.bodyMedium,
                    color = colors.textSecondary,
                )
            }
        },
        confirmButton = {
            DsPrimaryButton(text = stringResource(R.string.a11y_disclosure_accept), onClick = onAccept)
        },
        dismissButton = {
            TextButton(onClick = onDecline) {
                Text(stringResource(R.string.a11y_disclosure_decline), color = colors.textSecondary)
            }
        },
    )
}
