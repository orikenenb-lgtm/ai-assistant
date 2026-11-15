package ai.noa.bridge.app.ui.home

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.components.BannerKind
import ai.noa.bridge.app.ui.components.ConfirmDialog
import ai.noa.bridge.app.ui.components.MinTouchTarget
import ai.noa.bridge.app.ui.components.NoaCard
import ai.noa.bridge.app.ui.components.NoticeBanner
import ai.noa.bridge.app.ui.components.ScreenTitle
import ai.noa.bridge.app.ui.components.StatusCard
import ai.noa.bridge.app.ui.components.StatusLevel
import ai.noa.bridge.app.ui.components.StatusPill
import ai.noa.bridge.app.ui.components.pendingCount
import ai.noa.bridge.app.ui.theme.NoaStatus
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.Draft
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
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun HomeScreen(
    controller: AppController,
    status: BridgeStatus,
    settings: BridgeSettings,
    drafts: List<Draft>,
    onOpenDrafts: () -> Unit,
    onOpenPairing: () -> Unit,
    onOpenSettings: () -> Unit,
    onRequestPostNotifications: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var confirmStop by rememberSaveable { mutableStateOf(false) }
    var confirmResume by rememberSaveable { mutableStateOf(false) }
    val pending = drafts.pendingCount()

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ScreenTitle(stringResource(R.string.app_title), subtitle = stringResource(R.string.home_subtitle))

        if (settings.emergencyStopped) {
            NoticeBanner(
                kind = BannerKind.DANGER,
                title = stringResource(R.string.home_stopped_title),
                body = stringResource(R.string.home_stopped_body),
                modifier = Modifier.testTag("emergencyBanner"),
                action = {
                    Button(
                        onClick = { confirmResume = true },
                        modifier = Modifier.heightIn(min = MinTouchTarget).testTag("resumeButton"),
                    ) { Text(stringResource(R.string.home_resume)) }
                },
            )
        }

        status.lastErrorHebrew?.takeIf { it.isNotBlank() }?.let { error ->
            NoticeBanner(kind = BannerKind.WARNING, title = stringResource(R.string.home_last_error_title), body = error)
        }

        if (!settings.cloudConsentGiven) {
            NoticeBanner(
                kind = BannerKind.INFO,
                title = stringResource(R.string.home_no_consent_title),
                body = stringResource(R.string.home_no_consent_body),
                action = {
                    TextButton(onClick = onOpenSettings, modifier = Modifier.heightIn(min = MinTouchTarget)) {
                        Text(stringResource(R.string.home_action_privacy_settings))
                    }
                },
            )
        }

        if (settings.sendingEnabled) {
            NoticeBanner(
                kind = BannerKind.WARNING,
                title = stringResource(R.string.home_experimental_title),
                body = stringResource(R.string.home_experimental_body),
            )
        }

        PendingCard(pending = pending, onOpenDrafts = onOpenDrafts)
        ServerCard(status = status, onOpenPairing = onOpenPairing)
        WhatsAppCard(status = status, onOpenAccess = controller::openNotificationAccessSettings)
        PermissionsCard(
            status = status,
            onOpenAccess = controller::openNotificationAccessSettings,
            onRequestPostNotifications = onRequestPostNotifications,
        )

        PauseRow(
            paused = settings.paused,
            enabled = !settings.emergencyStopped,
            onToggle = { controller.setPaused(it) },
        )

        if (!settings.emergencyStopped) {
            EmergencyStopButton(onClick = { confirmStop = true })
        }
        Spacer(Modifier.padding(bottom = 8.dp))
    }

    if (confirmStop) {
        ConfirmDialog(
            title = stringResource(R.string.home_emergency_dialog_title),
            body = stringResource(R.string.home_emergency_dialog_body),
            confirmLabel = stringResource(R.string.home_emergency_dialog_confirm),
            destructive = true,
            onConfirm = {
                confirmStop = false
                controller.emergencyStop()
            },
            onDismiss = { confirmStop = false },
        )
    }
    if (confirmResume) {
        ConfirmDialog(
            title = stringResource(R.string.home_resume_dialog_title),
            body = stringResource(R.string.home_resume_dialog_body),
            confirmLabel = stringResource(R.string.home_resume_dialog_confirm),
            onConfirm = {
                confirmResume = false
                controller.resumeAfterEmergencyStop()
            },
            onDismiss = { confirmResume = false },
        )
    }
}

@Composable
private fun PendingCard(pending: Int, onOpenDrafts: () -> Unit) {
    StatusCard(
        title = stringResource(R.string.home_card_pending_title),
        icon = Icons.Filled.Edit,
        level = if (pending > 0) StatusLevel.ATTENTION else StatusLevel.NEUTRAL,
        statusLabel = pending.toString(),
        body = {
            Text(
                when (pending) {
                    0 -> stringResource(R.string.home_pending_none)
                    1 -> stringResource(R.string.home_pending_one)
                    else -> stringResource(R.string.home_pending_count, pending)
                },
                style = MaterialTheme.typography.bodyMedium,
            )
        },
        actions = {
            FilledTonalButton(onClick = onOpenDrafts, modifier = Modifier.heightIn(min = MinTouchTarget)) {
                Text(stringResource(R.string.home_action_open_drafts))
            }
        },
    )
}

@Composable
private fun ServerCard(status: BridgeStatus, onOpenPairing: () -> Unit) {
    val (level, label, body) = when {
        !status.paired -> Triple(StatusLevel.PROBLEM, stringResource(R.string.cd_status_problem), stringResource(R.string.home_server_not_paired))
        status.backendReachable == true -> Triple(StatusLevel.OK, stringResource(R.string.cd_status_ok), stringResource(R.string.home_server_paired_reachable))
        status.backendReachable == false -> Triple(StatusLevel.ATTENTION, stringResource(R.string.cd_status_attention), stringResource(R.string.home_server_paired_unreachable))
        else -> Triple(StatusLevel.NEUTRAL, stringResource(R.string.cd_info), stringResource(R.string.home_server_paired_unknown))
    }
    StatusCard(
        title = stringResource(R.string.home_card_server_title),
        icon = Icons.Filled.Share,
        level = level,
        statusLabel = label,
        body = {
            Text(body, style = MaterialTheme.typography.bodyMedium)
            status.backendBaseUrl?.takeIf { status.paired }?.let {
                Text(
                    stringResource(R.string.home_server_address, it),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        actions = if (!status.paired) {
            {
                Button(onClick = onOpenPairing, modifier = Modifier.heightIn(min = MinTouchTarget)) {
                    Text(stringResource(R.string.home_action_pair))
                }
            }
        } else null,
    )
}

@Composable
private fun WhatsAppCard(status: BridgeStatus, onOpenAccess: () -> Unit) {
    val (level, label, body) = when {
        !status.notificationAccessGranted -> Triple(StatusLevel.PROBLEM, stringResource(R.string.cd_status_problem), stringResource(R.string.home_whatsapp_no_access))
        !status.listenerConnected -> Triple(StatusLevel.ATTENTION, stringResource(R.string.cd_status_attention), stringResource(R.string.home_whatsapp_not_connected))
        else -> Triple(StatusLevel.OK, stringResource(R.string.cd_status_ok), stringResource(R.string.home_whatsapp_ok))
    }
    StatusCard(
        title = stringResource(R.string.home_card_whatsapp_title),
        icon = Icons.Filled.Notifications,
        level = level,
        statusLabel = label,
        body = { Text(body, style = MaterialTheme.typography.bodyMedium) },
        actions = if (!status.notificationAccessGranted) {
            {
                Button(onClick = onOpenAccess, modifier = Modifier.heightIn(min = MinTouchTarget)) {
                    Text(stringResource(R.string.action_grant))
                }
            }
        } else null,
    )
}

@Composable
fun PermissionsCard(
    status: BridgeStatus,
    onOpenAccess: () -> Unit,
    onRequestPostNotifications: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val allGranted = status.notificationAccessGranted && status.postNotificationsGranted
    StatusCard(
        title = stringResource(R.string.home_card_permissions_title),
        icon = Icons.Filled.Lock,
        level = if (allGranted) StatusLevel.OK else StatusLevel.ATTENTION,
        statusLabel = stringResource(if (allGranted) R.string.cd_status_ok else R.string.cd_status_attention),
        modifier = modifier,
        body = {
            PermissionRow(
                title = stringResource(R.string.home_perm_notification_access),
                description = stringResource(R.string.home_perm_notification_access_desc),
                granted = status.notificationAccessGranted,
                actionLabel = stringResource(if (status.notificationAccessGranted) R.string.action_manage else R.string.action_grant),
                onAction = onOpenAccess,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            PermissionRow(
                title = stringResource(R.string.home_perm_post_notifications),
                description = stringResource(R.string.home_perm_post_notifications_desc),
                granted = status.postNotificationsGranted,
                actionLabel = if (status.postNotificationsGranted) null else stringResource(R.string.action_grant),
                onAction = onRequestPostNotifications,
            )
        },
    )
}

@Composable
private fun PermissionRow(
    title: String,
    description: String,
    granted: Boolean,
    actionLabel: String?,
    onAction: () -> Unit,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            StatusPill(
                level = if (granted) StatusLevel.OK else StatusLevel.PROBLEM,
                label = stringResource(if (granted) R.string.perm_granted else R.string.perm_missing),
            )
        }
        Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (actionLabel != null) {
            OutlinedButton(onClick = onAction, modifier = Modifier.heightIn(min = MinTouchTarget)) { Text(actionLabel) }
        }
    }
}

@Composable
private fun PauseRow(paused: Boolean, enabled: Boolean, onToggle: (Boolean) -> Unit) {
    NoaCard {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = MinTouchTarget)
                .toggleable(value = paused, enabled = enabled, role = Role.Switch, onValueChange = onToggle)
                .testTag("pauseToggle"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    stringResource(R.string.home_pause_title),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    stringResource(if (paused) R.string.home_pause_desc_paused else R.string.home_pause_desc_active),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(12.dp))
            Switch(checked = paused, onCheckedChange = null, enabled = enabled)
        }
    }
}

@Composable
private fun EmergencyStopButton(onClick: () -> Unit) {
    val s = NoaStatus.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Button(
            onClick = onClick,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .testTag("emergencyStopButton"),
            colors = ButtonDefaults.buttonColors(containerColor = s.danger, contentColor = s.onDanger),
            shape = MaterialTheme.shapes.medium,
        ) {
            Icon(Icons.Filled.Warning, contentDescription = null, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(10.dp))
            Text(stringResource(R.string.home_emergency_stop), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        }
        Text(
            stringResource(R.string.home_emergency_stop_desc),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
    }
}
