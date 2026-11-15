package ai.noa.bridge.app.ui.drafts

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.components.ApprovableStates
import ai.noa.bridge.app.ui.components.BannerKind
import ai.noa.bridge.app.ui.components.CancellableStates
import ai.noa.bridge.app.ui.components.ConfirmDialog
import ai.noa.bridge.app.ui.components.DraftStateChip
import ai.noa.bridge.app.ui.components.EmergencyStopAction
import ai.noa.bridge.app.ui.components.SendAttemptStates
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
import ai.noa.bridge.core.DraftStateMachine
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
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ai.noa.bridge.app.ui.theme.NoaStatus

/** Which confirmation dialog is open (saved across recreation by name). */
private enum class DetailDialog { NONE, APPROVE, CANCEL, EXCLUDE }

/** Same limit the coordinator enforces on edits (UTF-16 units, like String.length). */
const val MAX_REPLY_CHARS = 4_000

/** States in which the approve dialog may confirm (APPROVED: re-approval after a refused send). */
private val ConfirmableStates = setOf(DraftState.AWAITING_APPROVAL, DraftState.APPROVED)

private fun AppController.liveDraft(id: String): Draft? = drafts.value.firstOrNull { it.id == id }

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
                // UX-03: emergency stop reachable from the draft itself.
                actions = { EmergencyStopAction(stopped = settings.emergencyStopped, onStop = controller::emergencyStop) },
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
    // The approve dialog is bound to the draft revision and state it was opened on (H-1).
    var dialogRevision by rememberSaveable(draft.id) { mutableIntStateOf(-1) }
    var dialogStateName by rememberSaveable(draft.id) { mutableStateOf(DraftState.AWAITING_APPROVAL.name) }
    var draftChanged by rememberSaveable(draft.id) { mutableStateOf(false) }
    var tooLongAttempt by rememberSaveable(draft.id) { mutableStateOf(false) }
    var errorRes by rememberSaveable(draft.id) { mutableIntStateOf(0) }
    var infoRes by rememberSaveable(draft.id) { mutableIntStateOf(0) }

    // Revisions only grow. Composition may lag one frame behind the controller (revision lower than
    // the one the dialog was opened on): wait. A higher revision, or the same revision in another
    // state, means the draft changed under the open dialog: close it at once.
    val approveDialogOpen = dialog == DetailDialog.APPROVE
    val dialogLagging = approveDialogOpen && draft.revision < dialogRevision
    val dialogStale = approveDialogOpen && !dialogLagging &&
        (draft.revision != dialogRevision || draft.state.name != dialogStateName)
    LaunchedEffect(dialogStale) {
        if (dialogStale) {
            dialogName = DetailDialog.NONE.name
            errorRes = 0
            infoRes = 0
            draftChanged = true
        }
    }

    val inFlight = sendAttempt == SendUiState.InFlight || draft.state == DraftState.SENDING
    val alreadyAttempted = sendAttempt != null
    // UX-06: after any send attempt the text is what was handed over, and the approve button is gone.
    val sendWasAttempted = alreadyAttempted || draft.state in SendAttemptStates
    val editable = draft.state in ApprovableStates && !alreadyAttempted && !settings.emergencyStopped
    val isDirty = text != serverText
    val overLimit = text.length > MAX_REPLY_CHARS
    val showTooLong = overLimit || tooLongAttempt
    val sendingPossible = settings.sendingEnabled && !status.deviceLocked
    val approveEnabled = editable && !inFlight && text.isNotBlank() && !overLimit &&
        !(settings.sendingEnabled && status.deviceLocked)

    /**
     * Saves the local edit through the coordinator (the single trimming point) and returns the live
     * draft afterwards, or null (with an error shown) when nothing approvable was stored.
     */
    fun saveEdit(): Draft? {
        val toSave = text.trim()
        if (toSave.isEmpty()) {
            errorRes = R.string.detail_empty_text_error
            return null
        }
        if (toSave.length > MAX_REPLY_CHARS) {
            tooLongAttempt = true
            return null
        }
        val before = controller.liveDraft(draft.id) ?: return null
        if (toSave == before.finalText) {
            text = toSave // only surrounding whitespace differed: nothing to store
            return before
        }
        controller.editDraft(draft.id, toSave)
        val after = controller.liveDraft(draft.id)
        if (after == null || after.revision == before.revision || after.finalText != toSave) {
            errorRes = R.string.detail_approve_failed
            return null
        }
        text = after.finalText.orEmpty()
        return after
    }

    /** Opens the approve dialog on the STORED text of the live draft, saving a local edit first. */
    fun openApproveDialog() {
        errorRes = 0
        infoRes = 0
        draftChanged = false
        if (text.isBlank()) {
            errorRes = R.string.detail_empty_text_error
            return
        }
        val live = if (text != (controller.liveDraft(draft.id)?.finalText ?: serverText)) {
            saveEdit() ?: return
        } else {
            controller.liveDraft(draft.id)
        }
        if (live == null || live.state !in ConfirmableStates || live.finalText.isNullOrBlank()) {
            errorRes = R.string.detail_approve_failed
            return
        }
        dialogRevision = live.revision
        dialogStateName = live.state.name
        dialogName = DetailDialog.APPROVE.name
    }

    /** The live draft, if it is still exactly what the open dialog showed; otherwise closes as "changed". */
    fun unchangedSinceDialogOpened(): Draft? {
        val live = controller.liveDraft(draft.id)
        val ok = live != null && live.revision == dialogRevision && live.state.name == dialogStateName &&
            live.state in ConfirmableStates && !live.finalText.isNullOrBlank()
        if (!ok) {
            draftChanged = true
            return null
        }
        return live
    }
    val cancelEnabled = draft.state in CancellableStates && !inFlight && !alreadyAttempted

    /** UX-07: with sending off the primary action copies the STORED text — nothing is "approved". */
    fun copyStoredText() {
        errorRes = 0
        infoRes = 0
        draftChanged = false
        if (text.isBlank()) {
            errorRes = R.string.detail_empty_text_error
            return
        }
        val live = if (text != (controller.liveDraft(draft.id)?.finalText ?: serverText)) {
            saveEdit() ?: return
        } else {
            controller.liveDraft(draft.id)
        }
        val stored = live?.finalText
        if (live == null || live.state !in ConfirmableStates || stored.isNullOrBlank()) {
            errorRes = R.string.detail_approve_failed
            return
        }
        copyToClipboard(context, stored)
        infoRes = R.string.detail_copied
    }
    val contentScrubbed = draft.state in DraftStateMachine.terminalStates &&
        draft.sourceMessages.isEmpty() && draft.finalText == null

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

        if (contentScrubbed) {
            Text(
                stringResource(R.string.detail_content_scrubbed),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("contentScrubbed"),
            )
        }

        SectionHeader(stringResource(R.string.detail_incoming_header))
        draft.sourceMessages.forEach { IncomingBubble(it) }

        SectionHeader(stringResource(if (sendWasAttempted) R.string.detail_reply_header_sent else R.string.detail_reply_header))
        if (draft.finalText == null && draft.state !in ApprovableStates) {
            Text(stringResource(R.string.detail_reply_waiting), style = MaterialTheme.typography.bodyMedium)
        } else {
            OutlinedTextField(
                value = text,
                onValueChange = { new ->
                    // Enforce the limit visibly instead of letting the coordinator drop the edit.
                    if (new.length > MAX_REPLY_CHARS) {
                        tooLongAttempt = true
                    } else {
                        text = new
                        tooLongAttempt = false
                    }
                    errorRes = 0
                    infoRes = 0
                    draftChanged = false
                },
                label = { Text(stringResource(R.string.detail_reply_label)) },
                readOnly = !editable,
                minLines = 3,
                textStyle = MaterialTheme.typography.bodyLarge,
                isError = showTooLong,
                supportingText = when {
                    showTooLong -> { { Text(stringResource(R.string.detail_text_too_long), modifier = Modifier.testTag("textTooLong")) } }
                    isDirty -> { { Text(stringResource(R.string.detail_unsaved_changes)) } }
                    draft.editedText != null -> { { Text(stringResource(R.string.detail_edited_marker)) } }
                    else -> null
                },
                modifier = Modifier.fillMaxWidth().testTag("replyField"),
            )
            if (editable) {
                TextButton(
                    onClick = {
                        errorRes = 0
                        infoRes = 0
                        if (saveEdit() != null) infoRes = R.string.detail_edit_saved
                    },
                    enabled = isDirty && text.isNotBlank() && !inFlight && !overLimit,
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

        if (draftChanged) {
            NoticeBanner(
                BannerKind.WARNING,
                stringResource(R.string.detail_draft_changed),
                modifier = Modifier.testTag("draftChangedNotice").semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }
        if (errorRes != 0) {
            NoticeBanner(
                BannerKind.DANGER,
                stringResource(errorRes),
                modifier = Modifier.testTag("detailError"),
                liveRegion = LiveRegionMode.Polite,
            )
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
        if (!sendWasAttempted) {
            Button(
                onClick = { if (settings.sendingEnabled) openApproveDialog() else copyStoredText() },
                enabled = approveEnabled,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("approveButton"),
                shape = MaterialTheme.shapes.medium,
            ) {
                if (settings.sendingEnabled) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                }
                Text(
                    stringResource(if (settings.sendingEnabled) R.string.detail_approve_send else R.string.detail_copy_text),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
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
        DetailDialog.APPROVE -> if (dialogLagging || dialogStale) {
            Unit // waiting for composition to catch up, or about to close as "changed"
        } else {
            // Always the STORED text of the live draft at the revision the dialog was opened on.
            val shownText = draft.finalText.orEmpty()
            // Only reachable with sending on (UX-07: with sending off the button copies directly).
            ConfirmDialog(
                title = stringResource(R.string.approve_dialog_title),
                confirmLabel = stringResource(R.string.approve_dialog_confirm),
                confirmEnabled = sendingPossible && !inFlight && !alreadyAttempted,
                filterObscuredTouches = true,
                onDismiss = { dialogName = DetailDialog.NONE.name },
                onConfirm = {
                    dialogName = DetailDialog.NONE.name
                    // Never edits: approves exactly the stored text, only if nothing changed.
                    val live = unchangedSinceDialogOpened() ?: return@ConfirmDialog
                    val approval = controller.approveDraft(live.id, live.finalText!!)
                    if (approval == null) {
                        errorRes = R.string.detail_approve_failed
                    } else if (!onSend(approval)) {
                        errorRes = R.string.detail_already_attempted
                    }
                },
                modifier = Modifier.testTag("approveDialog"),
            ) {
                // UX-04: repeat the safety warning where the decision is made.
                if (draft.safety.injectionSuspected || draft.safety.sensitiveRequest) {
                    NoticeBanner(
                        BannerKind.WARNING,
                        stringResource(R.string.approve_dialog_safety),
                        modifier = Modifier.testTag("approveDialogSafety"),
                    )
                }
                Text(
                    stringResource(R.string.approve_dialog_recipient, draft.senderDisplayName),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.testTag("approveDialogRecipient"),
                )
                Text(stringResource(R.string.approve_dialog_exact_text), style = MaterialTheme.typography.bodyMedium)
                ExactTextBox(shownText)
                if (settings.sendingEnabled && status.deviceLocked) {
                    Text(stringResource(R.string.detail_locked_notice), style = MaterialTheme.typography.bodyMedium)
                }
                Text(
                    stringResource(R.string.approve_dialog_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        DetailDialog.CANCEL -> ConfirmDialog(
            title = stringResource(R.string.cancel_dialog_title),
            body = stringResource(R.string.cancel_dialog_body),
            confirmLabel = stringResource(R.string.cancel_dialog_confirm),
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

/**
 * A11Y-01: TalkBack must read the message itself. The bubble merges its children so the text is
 * read as one item; sender and time are a stateDescription (read after the text), never a
 * contentDescription (which would replace the text).
 */
@Composable
private fun IncomingBubble(message: IncomingMessage) {
    val time = formatClockTime(message.timestampMillis)
    val meta = stringResource(R.string.cd_message_meta, message.senderDisplayName, time)
    // Incoming messages sit at the start edge (right side in RTL), like in WhatsApp.
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            contentColor = MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 16.dp),
            modifier = Modifier
                .widthIn(max = 520.dp)
                .fillMaxWidth(0.88f)
                .testTag("incomingBubble")
                .semantics(mergeDescendants = true) { stateDescription = meta },
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
                DraftState.SEND_ATTEMPTED -> BannerKind.INFO // UX-06: handed over, not "delivered"
                DraftState.FAILED -> BannerKind.DANGER
                DraftState.UNKNOWN_RESULT -> BannerKind.WARNING
                else -> BannerKind.INFO
            }
            NoticeBanner(
                kind = kind,
                title = stringResource(attempt.result.labelRes()),
                body = stringResource(attempt.result.explanationRes()),
                modifier = Modifier.testTag("sendResult_${attempt.result.name}"),
                liveRegion = LiveRegionMode.Assertive,
            )
        }
        SendUiState.Crashed -> NoticeBanner(
            kind = BannerKind.WARNING,
            title = stringResource(R.string.state_unknown_result),
            body = stringResource(R.string.detail_send_exception),
            modifier = Modifier.testTag("sendResult_CRASHED"),
            liveRegion = LiveRegionMode.Assertive,
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
