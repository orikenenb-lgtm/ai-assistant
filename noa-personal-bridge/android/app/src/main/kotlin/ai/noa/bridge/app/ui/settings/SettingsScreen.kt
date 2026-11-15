package ai.noa.bridge.app.ui.settings

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.ExclusionEntry
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.components.BannerKind
import ai.noa.bridge.app.ui.components.ConfirmDialog
import ai.noa.bridge.app.ui.components.MinTouchTarget
import ai.noa.bridge.app.ui.components.NoaCard
import ai.noa.bridge.app.ui.components.NoticeBanner
import ai.noa.bridge.app.ui.components.ScreenTitle
import ai.noa.bridge.app.ui.components.SectionHeader
import ai.noa.bridge.app.ui.home.PermissionsCard
import ai.noa.bridge.app.ui.theme.NoaStatus
import ai.noa.bridge.core.BridgeSettings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private enum class SettingsDialog { NONE, CONSENT, SENDING, WIPE, DISCONNECT }

@Composable
fun SettingsScreen(
    controller: AppController,
    status: BridgeStatus,
    settings: BridgeSettings,
    exclusions: List<ExclusionEntry>,
    appVersion: String,
    sendingCompiledIn: Boolean,
    onOpenPairing: () -> Unit,
    onRequestPostNotifications: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var dialogName by rememberSaveable { mutableStateOf(SettingsDialog.NONE.name) }
    var busy by rememberSaveable { mutableStateOf(false) }
    var resultRes by rememberSaveable { mutableStateOf(0) }
    var resultIsError by rememberSaveable { mutableStateOf(false) }

    fun runSuspend(doneRes: Int, block: suspend () -> Unit) {
        if (busy) return
        busy = true
        resultRes = 0
        scope.launch {
            try {
                block()
                resultRes = doneRes
                resultIsError = false
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                resultRes = R.string.settings_operation_failed
                resultIsError = true
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ScreenTitle(stringResource(R.string.settings_title))

        if (resultRes != 0) {
            NoticeBanner(if (resultIsError) BannerKind.DANGER else BannerKind.SUCCESS, stringResource(resultRes))
        }

        // ---- Behavior ----
        SectionHeader(stringResource(R.string.settings_section_behavior))
        NoaCard {
            InfoRow(
                title = stringResource(R.string.settings_debounce_title),
                description = stringResource(R.string.settings_debounce_desc),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            LockedOnRow(
                title = stringResource(R.string.settings_private_only_title),
                description = stringResource(R.string.settings_private_only_desc),
            )
        }

        // ---- Exclusions ----
        SectionHeader(stringResource(R.string.settings_section_exclusions))
        NoaCard {
            if (exclusions.isEmpty()) {
                Text(
                    stringResource(R.string.settings_exclusions_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                exclusions.forEachIndexed { index, entry ->
                    if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    val cd = stringResource(R.string.cd_remove_exclusion, entry.displayName)
                    Row(Modifier.fillMaxWidth().heightIn(min = MinTouchTarget), verticalAlignment = Alignment.CenterVertically) {
                        Text(entry.displayName, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        TextButton(
                            onClick = { controller.removeExclusion(entry.conversationKeyValue) },
                            modifier = Modifier
                                .heightIn(min = MinTouchTarget)
                                .semantics { contentDescription = cd }
                                .testTag("removeExclusion_${entry.conversationKeyValue}"),
                        ) { Text(stringResource(R.string.settings_exclusion_remove)) }
                    }
                }
            }
        }

        // ---- Permissions ----
        SectionHeader(stringResource(R.string.settings_section_permissions))
        PermissionsCard(
            status = status,
            onOpenAccess = controller::openNotificationAccessSettings,
            onRequestPostNotifications = onRequestPostNotifications,
        )

        // ---- Privacy ----
        SectionHeader(stringResource(R.string.settings_section_privacy))
        NoaCard {
            SwitchRow(
                title = stringResource(R.string.settings_consent_title),
                description = stringResource(if (settings.cloudConsentGiven) R.string.settings_consent_desc_on else R.string.settings_consent_desc_off),
                checked = settings.cloudConsentGiven,
                onCheckedChange = { on ->
                    // Turning ON always goes through the full disclosure first. Revoking is immediate.
                    if (on) dialogName = SettingsDialog.CONSENT.name else controller.setCloudConsent(false)
                },
                testTag = "consentSwitch",
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            SwitchRow(
                title = stringResource(R.string.settings_sending_title),
                description = when {
                    !sendingCompiledIn -> stringResource(R.string.settings_sending_unavailable)
                    settings.sendingEnabled -> stringResource(R.string.settings_sending_desc_on)
                    else -> stringResource(R.string.settings_sending_desc_off)
                },
                checked = settings.sendingEnabled && sendingCompiledIn,
                enabled = sendingCompiledIn && !settings.emergencyStopped,
                onCheckedChange = { on ->
                    if (on) dialogName = SettingsDialog.SENDING.name else controller.setSendingEnabled(false)
                },
                testTag = "sendingSwitch",
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            ActionRow(
                title = stringResource(R.string.settings_wipe_title),
                description = stringResource(R.string.settings_wipe_desc),
                danger = true,
                enabled = !busy,
                onClick = { dialogName = SettingsDialog.WIPE.name },
                testTag = "wipeRow",
            )
        }

        // ---- Connection ----
        SectionHeader(stringResource(R.string.settings_section_connection))
        NoaCard {
            ActionRow(
                title = stringResource(R.string.settings_pair_title),
                description = if (status.paired && status.backendBaseUrl != null) {
                    stringResource(R.string.settings_pair_desc_paired, status.backendBaseUrl)
                } else stringResource(R.string.settings_pair_desc_unpaired),
                onClick = onOpenPairing,
                testTag = "pairRow",
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            ActionRow(
                title = stringResource(R.string.settings_disconnect_title),
                description = stringResource(R.string.settings_disconnect_desc),
                danger = true,
                enabled = status.paired && !busy,
                onClick = { dialogName = SettingsDialog.DISCONNECT.name },
                testTag = "disconnectRow",
            )
        }
        if (busy) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            }
        }

        // ---- About ----
        SectionHeader(stringResource(R.string.settings_section_about))
        Text(
            stringResource(R.string.settings_version, appVersion),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.padding(bottom = 16.dp))
    }

    when (SettingsDialog.valueOf(dialogName)) {
        SettingsDialog.NONE -> Unit
        SettingsDialog.CONSENT -> ConsentDisclosureDialog(
            onAgree = {
                dialogName = SettingsDialog.NONE.name
                controller.setCloudConsent(true)
            },
            onDecline = { dialogName = SettingsDialog.NONE.name },
        )
        SettingsDialog.SENDING -> SendingWarningDialog(
            onConfirm = {
                dialogName = SettingsDialog.NONE.name
                controller.setSendingEnabled(true)
            },
            onDismiss = { dialogName = SettingsDialog.NONE.name },
        )
        SettingsDialog.WIPE -> ConfirmDialog(
            title = stringResource(R.string.settings_wipe_dialog_title),
            body = stringResource(R.string.settings_wipe_dialog_body),
            confirmLabel = stringResource(R.string.settings_wipe_dialog_confirm),
            destructive = true,
            onConfirm = {
                dialogName = SettingsDialog.NONE.name
                runSuspend(R.string.settings_wipe_done) { controller.wipeLocalData() }
            },
            onDismiss = { dialogName = SettingsDialog.NONE.name },
        )
        SettingsDialog.DISCONNECT -> ConfirmDialog(
            title = stringResource(R.string.settings_disconnect_dialog_title),
            body = stringResource(R.string.settings_disconnect_dialog_body),
            confirmLabel = stringResource(R.string.settings_disconnect_dialog_confirm),
            destructive = true,
            onConfirm = {
                dialogName = SettingsDialog.NONE.name
                runSuspend(R.string.settings_disconnect_done) { controller.disconnect() }
            },
            onDismiss = { dialogName = SettingsDialog.NONE.name },
        )
    }
}

@Composable
private fun RowText(title: String, description: String, modifier: Modifier = Modifier, titleColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = titleColor)
        Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun InfoRow(title: String, description: String) {
    RowText(title, description, Modifier.fillMaxWidth())
}

@Composable
private fun LockedOnRow(title: String, description: String) {
    Row(Modifier.fillMaxWidth().heightIn(min = MinTouchTarget), verticalAlignment = Alignment.CenterVertically) {
        RowText(title, description, Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Surface(
            color = NoaStatus.colors.successContainer,
            contentColor = NoaStatus.colors.onSuccessContainer,
            shape = MaterialTheme.shapes.small,
        ) {
            Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Lock, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.settings_locked_on), style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@Composable
private fun SwitchRow(
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    testTag: String,
    enabled: Boolean = true,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = MinTouchTarget)
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
            .testTag(testTag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowText(title, description, Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

@Composable
private fun ActionRow(
    title: String,
    description: String,
    onClick: () -> Unit,
    testTag: String,
    danger: Boolean = false,
    enabled: Boolean = true,
) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = MinTouchTarget).testTag(testTag),
        shape = MaterialTheme.shapes.small,
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            RowText(
                title,
                description,
                Modifier.weight(1f),
                titleColor = when {
                    !enabled -> MaterialTheme.colorScheme.onSurfaceVariant
                    danger -> NoaStatus.colors.danger
                    else -> MaterialTheme.colorScheme.onSurface
                },
            )
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
