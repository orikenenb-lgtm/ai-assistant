package ai.noa.bridge.app.ui.drafts

import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.components.ActiveStates
import ai.noa.bridge.app.ui.components.DraftStateChip
import ai.noa.bridge.app.ui.components.ScreenTitle
import ai.noa.bridge.app.ui.components.SectionHeader
import ai.noa.bridge.app.ui.components.explanationRes
import ai.noa.bridge.app.ui.components.relativeTimeLabel
import ai.noa.bridge.core.Draft
import ai.noa.bridge.core.DraftState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** The three sections of the drafts list (UX-01). */
data class DraftGroups(val needsYou: List<Draft>, val inProgress: List<Draft>, val history: List<Draft>)

/**
 * UX-01: what needs the user comes first — AWAITING_APPROVAL, then APPROVED (a refused send that can
 * be approved again) — then drafts still in progress, then history. Newest first inside each group.
 */
fun groupDrafts(drafts: List<Draft>): DraftGroups {
    val newestFirst = compareByDescending<Draft> { it.updatedAtMillis }.thenByDescending { it.createdAtMillis }
    val needsYou = drafts.filter { it.state in NeedsYouStates }
        .sortedWith(compareBy<Draft> { NeedsYouStates.indexOf(it.state) }.then(newestFirst))
    val inProgress = drafts.filter { it.state in ActiveStates && it.state !in NeedsYouStates }.sortedWith(newestFirst)
    val history = drafts.filter { it.state !in ActiveStates }.sortedWith(newestFirst)
    return DraftGroups(needsYou, inProgress, history)
}

private val NeedsYouStates = listOf(DraftState.AWAITING_APPROVAL, DraftState.APPROVED)

@Composable
fun DraftsListScreen(
    drafts: List<Draft>,
    onOpenDraft: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Sorting is cheap, but keep it out of every recomposition.
    val groups = remember(drafts) { groupDrafts(drafts) }

    if (drafts.isEmpty()) {
        EmptyDrafts(modifier)
        return
    }

    LazyColumn(
        modifier = modifier.fillMaxSize().testTag("draftsList"),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(key = "title", contentType = "title") { ScreenTitle(stringResource(R.string.drafts_title)) }
        if (groups.needsYou.isNotEmpty()) {
            item(key = "h_needs_you", contentType = "header") {
                SectionHeader(stringResource(R.string.drafts_section_needs_you), Modifier.testTag("section_needs_you"))
            }
            items(groups.needsYou, key = { it.id }, contentType = { "draft" }) { draft ->
                DraftCard(draft = draft, onClick = { onOpenDraft(draft.id) })
            }
        }
        if (groups.inProgress.isNotEmpty()) {
            item(key = "h_active", contentType = "header") {
                SectionHeader(stringResource(R.string.drafts_section_active), Modifier.testTag("section_in_progress"))
            }
            items(groups.inProgress, key = { it.id }, contentType = { "draft" }) { draft ->
                DraftCard(draft = draft, onClick = { onOpenDraft(draft.id) })
            }
        }
        if (groups.history.isNotEmpty()) {
            item(key = "h_history", contentType = "header") {
                SectionHeader(stringResource(R.string.drafts_section_history), Modifier.testTag("section_history"))
            }
            items(groups.history, key = { it.id }, contentType = { "draft" }) { draft ->
                DraftCard(draft = draft, onClick = { onOpenDraft(draft.id) })
            }
        }
    }
}

@Composable
private fun DraftCard(draft: Draft, onClick: () -> Unit) {
    val lastIncoming = draft.sourceMessages.lastOrNull()
    val isHistory = draft.state !in ActiveStates
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().testTag("draftCard_${draft.id}"),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(
            containerColor = if (isHistory) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surfaceContainerLowest,
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(draft.senderDisplayName)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    // A11Y-05: not a heading — the card is a button; headings are the section titles only.
                    Text(
                        draft.senderDisplayName,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        relativeTimeLabel(draft.updatedAtMillis),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (lastIncoming != null) {
                Text(
                    lastIncoming.text,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                if (draft.sourceMessages.size > 1) {
                    Text(
                        stringResource(R.string.draft_messages_count, draft.sourceMessages.size),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            DraftStateChip(draft.state)
            if (draft.state == DraftState.DEBOUNCING) {
                Text(
                    stringResource(draft.state.explanationRes()),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
fun Avatar(name: String, modifier: Modifier = Modifier) {
    val initial = remember(name) { name.trim().firstOrNull()?.uppercase() ?: "?" }
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        modifier = modifier.size(44.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            // Decorative: the name is read right next to it.
            Text(initial, style = MaterialTheme.typography.titleMedium, modifier = Modifier.clearAndSetSemantics { })
        }
    }
}

@Composable
private fun EmptyDrafts(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp)
            .testTag("draftsEmpty"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ) {
            Icon(Icons.Filled.Email, contentDescription = null, modifier = Modifier.padding(20.dp).size(36.dp))
        }
        Text(
            stringResource(R.string.drafts_empty_title),
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            stringResource(R.string.drafts_empty_body),
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            stringResource(R.string.drafts_empty_checklist),
            style = MaterialTheme.typography.bodySmall,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
