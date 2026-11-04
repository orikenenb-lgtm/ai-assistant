package com.disciplineos.app.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.component.DsBadge
import com.disciplineos.app.designsystem.component.DsPreviewSurface
import com.disciplineos.app.designsystem.component.DsPreviews
import com.disciplineos.app.designsystem.theme.DisciplineColors
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.ui.common.Formatters
import com.disciplineos.app.ui.common.formatMinutes
import com.disciplineos.app.ui.common.labelRes
import com.disciplineos.app.ui.common.recurrenceLabel
import com.disciplineos.app.ui.common.relativeDayLabel
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.OccurrenceWithTask
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.RecurrenceRule
import com.disciplineos.core.model.SubTask
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.TaskOccurrence
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** Accent for a task kind: mandatory = orange, optional = blue. */
fun DisciplineColors.kindColor(kind: TaskKind): Color = if (kind == TaskKind.MANDATORY) mandatory else optional

/** Accent for a priority. */
fun DisciplineColors.priorityColor(priority: Priority): Color = when (priority) {
    Priority.LOW -> textSecondary
    Priority.MEDIUM -> primarySoft
    Priority.HIGH -> warning
    Priority.CRITICAL -> danger
}

/** True when this pending occurrence is past its deadline. */
fun OccurrenceWithTask.isOverdue(today: LocalDate, now: Instant): Boolean {
    if (occurrence.status != OccurrenceStatus.PENDING) return false
    if (occurrence.localDate.isBefore(today)) return true
    val due = occurrence.dueAt ?: return false
    return due.isBefore(now)
}

/**
 * One occurrence: kind accent stripe, quick-complete checkbox, title and a meta line
 * (date/time, overdue, snooze, subtasks, estimate, category). Tapping the row opens the task.
 */
@Composable
fun TaskOccurrenceRow(
    item: OccurrenceWithTask,
    today: LocalDate,
    now: Instant,
    busy: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    showDate: Boolean = false,
    showKind: Boolean = false,
    categoryName: String? = null,
) {
    val colors = DisciplineTheme.colors
    val task = item.task
    val occurrence = item.occurrence
    val accent = colors.kindColor(task.kind)
    val done = occurrence.status == OccurrenceStatus.COMPLETED
    val resolvedOther = occurrence.status == OccurrenceStatus.SKIPPED || occurrence.status == OccurrenceStatus.MISSED
    val overdue = item.isOverdue(today, now)
    val zone = remember(task.zoneId) { runCatching { ZoneId.of(task.zoneId) }.getOrDefault(ZoneId.systemDefault()) }
    val checkboxDescription = stringResource(R.string.core_cd_complete_task, task.title)

    val meta = buildList {
        if (showDate || occurrence.localDate != today) add(relativeDayLabel(occurrence.localDate, today))
        task.dueTime?.let { add(Formatters.time(it)) }
        val snoozed = occurrence.snoozedUntil
        if (occurrence.status == OccurrenceStatus.PENDING && snoozed != null && snoozed.isAfter(now)) {
            add(stringResource(R.string.core_snoozed_until, Formatters.time(snoozed, zone)))
        }
        if (item.subTasks.isNotEmpty()) {
            add(stringResource(R.string.core_subtasks_progress, item.subTasks.count { it.done }, item.subTasks.size))
        }
        task.estimatedMinutes?.let { add(formatMinutes(it)) }
        categoryName?.let { add(it) }
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(colors.surface)
            .border(1.dp, if (overdue) colors.danger.copy(alpha = 0.45f) else colors.outline.copy(alpha = 0.4f), RoundedCornerShape(16.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .padding(start = 8.dp)
                .width(4.dp)
                .height(36.dp)
                .clip(RoundedCornerShape(50))
                .background(if (done) colors.success else accent),
        )
        Checkbox(
            checked = done,
            onCheckedChange = if (resolvedOther) null else onCheckedChange,
            enabled = !busy && !resolvedOther,
            modifier = Modifier.semantics { contentDescription = checkboxDescription },
            colors = CheckboxDefaults.colors(
                checkedColor = colors.success,
                uncheckedColor = accent,
                checkmarkColor = colors.background,
                disabledCheckedColor = colors.success.copy(alpha = 0.5f),
                disabledUncheckedColor = colors.outline,
            ),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = task.title,
                style = DisciplineTheme.typography.bodyLarge,
                color = if (done || resolvedOther) colors.textMuted else colors.textPrimary,
                textDecoration = if (done) TextDecoration.LineThrough else null,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (meta.isNotEmpty()) {
                Text(
                    text = meta.joinToString(" · "),
                    style = DisciplineTheme.typography.bodySmall,
                    color = if (overdue) colors.danger else colors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            when {
                overdue -> DsBadge(text = stringResource(R.string.core_overdue), color = colors.danger)
                resolvedOther -> DsBadge(text = stringResource(occurrence.status.labelRes()), color = colors.textSecondary)
                showKind -> DsBadge(text = stringResource(task.kind.labelRes()), color = accent)
                task.priority >= Priority.HIGH -> DsBadge(text = stringResource(task.priority.labelRes()), color = colors.priorityColor(task.priority))
            }
        }
        Spacer(Modifier.width(12.dp))
    }
}

/** A recurring task template (no specific date). */
@Composable
fun RecurringTaskRow(
    task: Task,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    categoryName: String? = null,
) {
    val colors = DisciplineTheme.colors
    val accent = colors.kindColor(task.kind)
    val subtitle = listOfNotNull(
        recurrenceLabel(task.recurrence),
        task.dueTime?.let { Formatters.time(it) },
        categoryName,
    ).joinToString(" · ")
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(colors.surface)
            .border(1.dp, colors.outline.copy(alpha = 0.4f), RoundedCornerShape(16.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(accent.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Repeat, contentDescription = null, tint = accent, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = task.title,
                style = DisciplineTheme.typography.bodyLarge,
                color = colors.textPrimary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(text = subtitle, style = DisciplineTheme.typography.bodySmall, color = colors.textSecondary)
        }
        Spacer(Modifier.width(8.dp))
        DsBadge(text = stringResource(task.kind.labelRes()), color = accent)
    }
}

// ---------- Preview fixtures (also reused by other previews in this package) ----------

internal fun previewTask(
    id: Long,
    title: String,
    kind: TaskKind,
    priority: Priority = Priority.MEDIUM,
    time: LocalTime? = null,
    recurrence: RecurrenceRule = RecurrenceRule.None,
): Task {
    val now = Instant.parse("2026-11-04T08:00:00Z")
    return Task(
        id = id,
        title = title,
        kind = kind,
        priority = priority,
        startDate = LocalDate.of(2026, 11, 4),
        dueTime = time,
        zoneId = "Asia/Jerusalem",
        recurrence = recurrence,
        estimatedMinutes = 30,
        createdAt = now,
        updatedAt = now,
    )
}

internal fun previewItem(task: Task, status: OccurrenceStatus = OccurrenceStatus.PENDING, subTasks: Int = 0): OccurrenceWithTask =
    OccurrenceWithTask(
        occurrence = TaskOccurrence(id = task.id * 10, taskId = task.id, localDate = task.startDate, dueAt = null, status = status),
        task = task,
        subTasks = (0 until subTasks).map { SubTask(id = it.toLong(), taskId = task.id, title = "שלב ${it + 1}", done = it == 0, position = it) },
    )

@DsPreviews
@Composable
private fun TaskRowsPreview() {
    val today = LocalDate.of(2026, 11, 4)
    val now = Instant.parse("2026-11-04T08:00:00Z")
    DsPreviewSurface {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TaskOccurrenceRow(
                item = previewItem(previewTask(1, "להגיש דוח רבעוני", TaskKind.MANDATORY, Priority.CRITICAL, LocalTime.of(14, 0)), subTasks = 3),
                today = today, now = now, busy = false, onCheckedChange = {}, onClick = {},
            )
            TaskOccurrenceRow(
                item = previewItem(previewTask(2, "ריצה של 5 ק\"מ", TaskKind.OPTIONAL), OccurrenceStatus.COMPLETED),
                today = today, now = now, busy = false, onCheckedChange = {}, onClick = {}, showKind = true,
            )
            RecurringTaskRow(
                task = previewTask(3, "קריאה 20 דקות", TaskKind.OPTIONAL, recurrence = RecurrenceRule.Daily()),
                onClick = {},
            )
        }
    }
}
