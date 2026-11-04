package com.disciplineos.app.ui.common

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.disciplineos.app.R
import com.disciplineos.core.domain.task.TaskError
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.RecurrenceRule
import com.disciplineos.core.model.TaskHistoryType
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.VerificationMethod
import java.time.DayOfWeek

/** Hebrew copy for domain enums. Every TaskError has a human, actionable message. */
@StringRes
fun TaskError.messageRes(): Int = when (this) {
    TaskError.TITLE_BLANK -> R.string.core_err_title_blank
    TaskError.TITLE_TOO_LONG -> R.string.core_err_title_too_long
    TaskError.NOTES_TOO_LONG -> R.string.core_err_notes_too_long
    TaskError.INVALID_DATE_RANGE -> R.string.core_err_invalid_date_range
    TaskError.INVALID_REMINDER -> R.string.core_err_invalid_reminder
    TaskError.INVALID_ESTIMATE -> R.string.core_err_invalid_estimate
    TaskError.TOO_MANY_SUBTASKS -> R.string.core_err_too_many_subtasks
    TaskError.DEPENDENCY_NOT_FOUND -> R.string.core_err_dependency_not_found
    TaskError.DEPENDENCY_CYCLE -> R.string.core_err_dependency_cycle
    TaskError.DEPENDENCIES_INCOMPLETE -> R.string.core_err_dependencies_incomplete
    TaskError.VERIFICATION_REQUIRED -> R.string.core_err_verification_required
    TaskError.SNOOZE_LIMIT_REACHED -> R.string.core_err_snooze_limit
    TaskError.INVALID_SNOOZE -> R.string.core_err_invalid_snooze
    TaskError.NOT_FOUND -> R.string.core_err_not_found
    TaskError.ALREADY_RESOLVED -> R.string.core_err_already_resolved
}

/** Verification-specific explanation for [TaskError.VERIFICATION_REQUIRED]. */
@StringRes
fun VerificationMethod.requiredMessageRes(): Int = when (this) {
    VerificationMethod.NONE -> R.string.core_err_verification_required
    VerificationMethod.CHECKLIST -> R.string.core_verify_required_checklist
    VerificationMethod.FOCUS_TIMER -> R.string.core_verify_required_focus
    VerificationMethod.REFLECTION_NOTE -> R.string.core_verify_required_note
}

@StringRes
fun TaskKind.labelRes(): Int = when (this) {
    TaskKind.MANDATORY -> R.string.core_kind_mandatory
    TaskKind.OPTIONAL -> R.string.core_kind_optional
}

@StringRes
fun Priority.labelRes(): Int = when (this) {
    Priority.LOW -> R.string.core_priority_low
    Priority.MEDIUM -> R.string.core_priority_medium
    Priority.HIGH -> R.string.core_priority_high
    Priority.CRITICAL -> R.string.core_priority_critical
}

@StringRes
fun VerificationMethod.labelRes(): Int = when (this) {
    VerificationMethod.NONE -> R.string.core_verify_none
    VerificationMethod.CHECKLIST -> R.string.core_verify_checklist
    VerificationMethod.FOCUS_TIMER -> R.string.core_verify_focus
    VerificationMethod.REFLECTION_NOTE -> R.string.core_verify_note
}

@StringRes
fun VerificationMethod.descriptionRes(): Int = when (this) {
    VerificationMethod.NONE -> R.string.core_verify_none_desc
    VerificationMethod.CHECKLIST -> R.string.core_verify_checklist_desc
    VerificationMethod.FOCUS_TIMER -> R.string.core_verify_focus_desc
    VerificationMethod.REFLECTION_NOTE -> R.string.core_verify_note_desc
}

@StringRes
fun OccurrenceStatus.labelRes(): Int = when (this) {
    OccurrenceStatus.PENDING -> R.string.core_status_pending
    OccurrenceStatus.COMPLETED -> R.string.core_status_completed
    OccurrenceStatus.SKIPPED -> R.string.core_status_skipped
    OccurrenceStatus.MISSED -> R.string.core_status_missed
}

@StringRes
fun TaskHistoryType.labelRes(): Int = when (this) {
    TaskHistoryType.CREATED -> R.string.core_history_created
    TaskHistoryType.EDITED -> R.string.core_history_edited
    TaskHistoryType.COMPLETED -> R.string.core_history_completed
    TaskHistoryType.UNCOMPLETED -> R.string.core_history_uncompleted
    TaskHistoryType.SNOOZED -> R.string.core_history_snoozed
    TaskHistoryType.SKIPPED -> R.string.core_history_skipped
    TaskHistoryType.MISSED -> R.string.core_history_missed
    TaskHistoryType.DELETED -> R.string.core_history_deleted
    TaskHistoryType.ARCHIVED -> R.string.core_history_archived
}

/** Human description of a recurrence rule, e.g. "כל שבוע: א׳, ג׳". */
@Composable
fun recurrenceLabel(rule: RecurrenceRule): String {
    val locale = currentLocale()
    return when (rule) {
        RecurrenceRule.None -> stringResource(R.string.core_recurrence_none)
        is RecurrenceRule.Daily ->
            if (rule.everyNDays == 1) stringResource(R.string.core_recurrence_daily)
            else stringResource(R.string.core_recurrence_every_n_days, rule.everyNDays)
        is RecurrenceRule.Weekly -> {
            val days = orderedWeek(DayOfWeek.SUNDAY)
                .filter { it in rule.daysOfWeek }
                .joinToString(", ") { Formatters.narrowDay(it, locale) }
            if (rule.everyNWeeks == 1) stringResource(R.string.core_recurrence_weekly_days, days)
            else stringResource(R.string.core_recurrence_every_n_weeks_days, rule.everyNWeeks, days)
        }
        is RecurrenceRule.Monthly -> stringResource(R.string.core_recurrence_monthly_day, rule.dayOfMonth)
    }
}

/** The 7 days of the week starting at [first]. */
fun orderedWeek(first: DayOfWeek): List<DayOfWeek> = (0L until 7L).map { first.plus(it) }
