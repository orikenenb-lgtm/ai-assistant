package ai.noa.bridge.app.ui.drafts

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.components.ApprovableStates
import ai.noa.bridge.app.ui.components.BannerKind
import ai.noa.bridge.app.ui.components.CancellableStates
import ai.noa.bridge.app.ui.components.ConfirmDialog
import ai.noa.bridge.app.ui.components.DraftStateChip
import ai.noa.bridge.app.ui.components.MinTouchTarget
import ai.noa.bridge.app.ui.components.NoticeBanner
import ai.noa.bridge.app.ui.components.SectionHeader
import ai.noa.bridge.app.ui.components.explanationRes
import ai.noa.bridge.app.ui.components.formatClockTime
import ai.noa.bridge.app.ui.components.labelRes
import ai.noa.bridge.core.Approval
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.Draft
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.IncomingMessage
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ai.noa.bridge.app.ui.theme.NoaStatus

/** Which confirmation dialog is open (saved across recreation by name). */
private enum class DetailDialog { NONE, APPROVE, CANCEL, EXCLUDE }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DraftDetailScreen(
    draftId: String,
    drafts: List<Draft>,
    status: BridgeStatus,
    settings: BridgeSettings,
    controller: AppController,
    sendAttempt: SendUiState?,
    onSend: (Approval) -> Boolean,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val draft = drafts.firstOrNull { it.id == draftId }
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.detail_title), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(draft?.senderDisplayName.orEmpty(), style = MaterialTheme.typography.titleLarge, maxLines = 1)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack, modifier = Modifier.testTag("backButton")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
            )
        },
    ) { inner ->
        if (draft == null) {
            Column(
                Modifier.padding(inner).fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(stringResource(R.string.detail_not_found_title), style = MaterialTheme.typography.titleLarge)
                Text(stringResource(R.string.detail_not_found_body), style = MaterialTheme.typography.bodyMedium)
                OutlinedButton(onClick = onBack, modifier = Modifier.heightIn(min = MinTouchTarget)) { Text(stringResource(R.string.action_back)) }
            }
        } else {
            DraftDetailContent(
                draft = draft,
                status = status,
                settings = settings,
                controller = controller,
                sendAttempt = sendAttempt,
                onSend = onSend,
                onExcluded = onBack,
                modifier = Modifier
                    .padding(inner)
                    .consumeWindowInsets(inner)
                    .imePadding(),
            )
        }
    }
}

@Composable
private fun DraftDetailContent(
    draft: Draft,
    status: BridgeStatus,
    settings: BridgeSettings,
    controller: AppController,
    sendAttempt: SendUiState?,
    onSend: (Approval) -> Boolean,
    onExcluded: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val serverText = draft.finalText.orEmpty()

    // Local editing buffer. [syncedText] is the server text the buffer was last aligned with, so a
    // new revision from the coordinator replaces the buffer only when the user has no local edits.
    var text by rememberSaveable(draft.id) { mutableStateOf(serverText) }
    var syncedText by rememberSaveable(draft.id) { mutableStateOf(serverText) }
    LaunchedEffect(serverText) {
        if (text == syncedText) text = serverText
        syncedText = serverText
    }

    var dialogName by rememberSaveable(draft.id) { mutableStateOf(DetailDialog.NONE.name) }
    val dialog = DetailDialog.valueOf(dialogName)
    var dialogText by rememberSaveable(draft.id) { mutableStateOf("") }
    var errorRes by rememberSaveable(draft.id) { mutableStateOf(0) }
    var infoRes by rememberSaveable(draft.id) { mutableStateOf(0) }

    val inFlight = sendAttempt == SendUiState.InFlight || draft.state == DraftState.SENDING
    val alreadyAttempted = sendAttempt != null
    val editable = draft.state in ApprovableStates && !alreadyAttempted && !settings.emergencyStopped
    val isDirty = text != serverText
    val sendingPossible = settings.sendingEnabled && !status.deviceLocked
    val approveEnabled = editable && !inFlight && text.isNotBlank() && !(settings.sendingEnabled && status.deviceLocked)
    val cancelEnabled = draft.state in CancellableStates && !inFlight && !alreadyAttempted

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) { DraftStateChip(draft.state) }
        Text(
            stringResource(draft.state.explanationRes()),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        draft.statusDetail?.takeIf { it.isNotBlank() }?.let {
            Text(
                stringResource(R.string.detail_status_detail, it),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.testTag("statusDetail"),
            )
        }

        if (draft.safety.injectionSuspected || draft.safety.sensitiveRequest) {
            SafetyBanner(draft)
        }

        SectionHeader(stringResource(R.string.detail_incoming_header))
        draft.sourceMessages.forEach { IncomingBubble(it) }

        SectionHeader(stringResource(R.string.detail_reply_header))
        if (draft.finalText == null && draft.state !in ApprovableStates) {
            Text(stringResource(R.string.detail_reply_waiting), style = MaterialTheme.typography.bodyMedium)
        } else {
            OutlinedTextField(
                value = text,
                onValueChange = {
                    text = it
                    errorRes = 0
                    infoRes = 0
                },
                label = { Text(stringResource(R.string.detail_reply_label)) },
                readOnly = !editable,
                minLines = 3,
                textStyle = MaterialTheme.typography.bodyLarge,
                supportingText = when {
                    isDirty -> { { Text(stringResource(R.string.detail_unsaved_changes)) } }
                    draft.editedText != null -> { { Text(stringResource(R.string.detail_edited_marker)) } }
                    else -> null
                },
                modifier = Modifier.fillMaxWidth().testTag("replyField"),
            )
            if (editable) {
                TextButton(
                    onClick = {
                        controller.editDraft(draft.id, text)
                        infoRes = R.string.detail_edit_saved
                    },
                    enabled = isDirty && text.isNotBlank() && !inFlight,
                    modifier = Modifier.heightIn(min = MinTouchTarget).testTag("saveEditButton"),
                ) { Text(stringResource(R.string.detail_save_edit)) }
            }
        }

        // Honest explanations for disabled actions.
        if (settings.sendingEnabled && status.deviceLocked && editable) {
            NoticeBanner(BannerKind.WARNING, stringResource(R.string.detail_locked_notice))
        }
        if (!settings.sendingEnabled && editable) {
            NoticeBanner(BannerKind.INFO, stringResource(R.string.detail_sending_off_notice))
        }

        SendProgressOrResult(sendAttempt)

        if (errorRes != 0) {
            NoticeBanner(BannerKind.DANGER, stringResource(errorRes), modifier = Modifier.testTag("detailError"))
        }
        if (infoRes != 0) {
            Text(
                stringResource(infoRes),
                style = MaterialTheme.typography.bodyMedium,
                color = NoaStatus.colors.success,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        // ---- Actions ----
        Button(
            onClick = {
                errorRes = 0
                infoRes = 0
                if (text.isBlank()) {
                    errorRes = R.string.detail_empty_text_error
                } else {
                    dialogText = text
                    dialogName = DetailDialog.APPROVE.name
                }
            },
            enabled = approveEnabled,
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("approveButton"),
            shape = MaterialTheme.shapes.medium,
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(if (settings.sendingEnabled) R.string.detail_approve_send else R.string.detail_approve_copy),
                style = MaterialTheme.typography.titleMedium,
            )
        }
        if (alreadyAttempted) {
            Text(
                stringResource(R.string.detail_already_attempted),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { dialogName = DetailDialog.CANCEL.name },
                enabled = cancelEnabled,
                modifier = Modifier.weight(1f).heightIn(min = MinTouchTarget).testTag("cancelDraftButton"),
            ) { Text(stringResource(R.string.detail_cancel_draft)) }
            OutlinedButton(
                onClick = { dialogName = DetailDialog.EXCLUDE.name },
                enabled = !inFlight,
                modifier = Modifier.weight(1f).heightIn(min = MinTouchTarget).testTag("excludeButton"),
            ) { Text(stringResource(R.string.detail_exclude)) }
        }
        Spacer(Modifier.padding(bottom = 16.dp))
    }

    when (dialog) {
        DetailDialog.NONE -> Unit
        DetailDialog.APPROVE -> {
            if (sendingPossible) {
                ConfirmDialog(
                    title = stringResource(R.string.approve_dialog_title),
                    confirmLabel = stringResource(R.string.approve_dialog_confirm),
                    confirmEnabled = !inFlight && !alreadyAttempted,
                    onDismiss = { dialogName = DetailDialog.NONE.name },
                    onConfirm = {
                        dialogName = DetailDialog.NONE.name
                        val exact = dialogText
                        if (exact != serverText) controller.editDraft(draft.id, exact)
                        val approval = controller.approveDraft(draft.id, exact)
                        if (approval == null) {
                            errorRes = R.string.detail_approve_failed
                        } else if (!onSend(approval)) {
                            errorRes = R.string.detail_already_attempted
                        }
                    },
                    modifier = Modifier.testTag("approveDialog"),
                ) {
                    Text(
                        stringResource(R.string.approve_dialog_recipient, draft.senderDisplayName),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.testTag("approveDialogRecipient"),
                    )
                    Text(stringResource(R.string.approve_dialog_exact_text), style = MaterialTheme.typography.bodyMedium)
                    ExactTextBox(dialogText)
                    Text(
                        stringResource(R.string.approve_dialog_note),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                // Sending is off: never pretend to send. Offer the exact text for manual pasting.
                ConfirmDialog(
                    title = stringResource(R.string.approve_dialog_off_title),
                    confirmLabel = stringResource(R.string.approve_dialog_copy),
                    dismissLabel = stringResource(R.string.action_close),
                    onDismiss = { dialogName = DetailDialog.NONE.name },
                    onConfirm = {
                        copyToClipboard(context, dialogText)
                        dialogName = DetailDialog.NONE.name
                        infoRes = R.string.detail_copied
                    },
                    modifier = Modifier.testTag("approveDialog"),
                ) {
                    Text(
                        stringResource(R.string.approve_dialog_off_body, draft.senderDisplayName),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (settings.sendingEnabled && status.deviceLocked) {
                        Text(stringResource(R.string.detail_locked_notice), style = MaterialTheme.typography.bodyMedium)
                    }
                    ExactTextBox(dialogText)
                }
            }
        }
        DetailDialog.CANCEL -> ConfirmDialog(
            title = stringResource(R.string.cancel_dialog_title),
            body = stringResource(R.string.cancel_dialog_body),
            confirmLabel = stringResource(R.string.cancel_dialog_confirm),
            dismissLabel = stringResource(R.string.action_keep),
            destructive = true,
            onDismiss = { dialogName = DetailDialog.NONE.name },
            onConfirm = {
                dialogName = DetailDialog.NONE.name
                controller.cancelDraft(draft.id)
            },
        )
        DetailDialog.EXCLUDE -> ConfirmDialog(
            title = stringResource(R.string.exclude_dialog_title, draft.senderDisplayName),
            body = stringResource(R.string.exclude_dialog_body),
            confirmLabel = stringResource(R.string.exclude_dialog_confirm),
            destructive = true,
            onDismiss = { dialogName = DetailDialog.NONE.name },
            onConfirm = {
                dialogName = DetailDialog.NONE.name
                controller.excludeConversationOf(draft.id)
                onExcluded()
            },
        )
    }
}

@Composable
private fun ExactTextBox(text: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = MaterialTheme.shapes.small,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.padding(12.dp).testTag("approveDialogText"),
        )
    }
}

@Composable
private fun SafetyBanner(draft: Draft) {
    val lines = buildList {
        if (draft.safety.injectionSuspected) add(stringResource(R.string.detail_safety_injection))
        if (draft.safety.sensitiveRequest) add(stringResource(R.string.detail_safety_sensitive))
        addAll(draft.safety.notes.filter { it.isNotBlank() })
    }
    NoticeBanner(
        kind = BannerKind.WARNING,
        title = stringResource(R.string.detail_safety_title),
        body = lines.joinToString("\n"),
        modifier = Modifier.testTag("safetyBanner"),
    )
}

@Composable
private fun IncomingBubble(message: IncomingMessage) {
    val time = formatClockTime(message.timestampMillis)
    val cd = stringResource(R.string.cd_message_from, message.senderDisplayName, time)
    // Incoming messages sit at the start edge (right side in RTL), like in WhatsApp.
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            contentColor = MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 16.dp),
            modifier = Modifier
                .widthIn(max = 520.dp)
                .fillMaxWidth(0.88f)
                .semantics(mergeDescendants = true) { contentDescription = cd },
        ) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                Text(message.text, style = MaterialTheme.typography.bodyLarge)
                Text(
                    time,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.End).clearAndSetSemantics { },
                )
            }
        }
    }
}

@Composable
private fun SendProgressOrResult(attempt: SendUiState?) {
    when (attempt) {
        null -> Unit
        SendUiState.InFlight -> Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .testTag("sendInFlight")
                .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        ) {
            CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.5.dp)
            Spacer(Modifier.width(12.dp))
            Text(stringResource(R.string.state_sending), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        }
        is SendUiState.Finished -> {
            val kind = when (attempt.result) {
                DraftState.SEND_ATTEMPTED -> BannerKind.SUCCESS
                DraftState.FAILED -> BannerKind.DANGER
                DraftState.UNKNOWN_RESULT -> BannerKind.WARNING
                else -> BannerKind.INFO
            }
            NoticeBanner(
                kind = kind,
                title = stringResource(attempt.result.labelRes()),
                body = stringResource(attempt.result.explanationRes()),
                modifier = Modifier
                    .testTag("sendResult_${attempt.result.name}")
                    .semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        SendUiState.Crashed -> NoticeBanner(
            kind = BannerKind.WARNING,
            title = stringResource(R.string.state_unknown_result),
            body = stringResource(R.string.detail_send_exception),
            modifier = Modifier.testTag("sendResult_CRASHED"),
        )
    }
}

/** Copies the reply, flagged as sensitive so Android 13+ hides it from the clipboard preview. */
private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
    val clip = ClipData.newPlainText("reply", text)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
    }
    clipboard.setPrimaryClip(clip)
}
