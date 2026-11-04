package com.disciplineos.app.data.backup

import com.disciplineos.app.data.local.entity.AchievementEntity
import com.disciplineos.app.data.local.entity.BlockedAppEntity
import com.disciplineos.app.data.local.entity.CategoryEntity
import com.disciplineos.app.data.local.entity.FocusSessionEntity
import com.disciplineos.app.data.local.entity.StreakFreezeEntity
import com.disciplineos.app.data.local.entity.SubTaskEntity
import com.disciplineos.app.data.local.entity.TaskDependencyEntity
import com.disciplineos.app.data.local.entity.TaskEntity
import com.disciplineos.app.data.local.entity.TaskHistoryEntity
import com.disciplineos.app.data.local.entity.TaskOccurrenceEntity
import com.disciplineos.app.data.local.entity.XpEventEntity
import com.disciplineos.app.data.mapper.ReminderOffsetsCodec
import com.disciplineos.core.model.AppLanguage
import com.disciplineos.core.model.AppSettings
import com.disciplineos.core.model.BlockerConfig
import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.TaskHistoryType
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.VerificationMethod
import com.disciplineos.core.model.XpSource
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.time.DateTimeException
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** Everything a backup carries, at entity/model level. Built from / applied to the DB by BackupManagerImpl. */
data class BackupSnapshot(
    val settings: AppSettings? = null,
    val blockerConfig: BlockerConfig? = null,
    val focusConfig: FocusConfig? = null,
    val categories: List<CategoryEntity> = emptyList(),
    val tasks: List<TaskEntity> = emptyList(),
    val dependencies: List<TaskDependencyEntity> = emptyList(),
    val subTasks: List<SubTaskEntity> = emptyList(),
    val occurrences: List<TaskOccurrenceEntity> = emptyList(),
    val history: List<TaskHistoryEntity> = emptyList(),
    val blockedApps: List<BlockedAppEntity> = emptyList(),
    val focusSessions: List<FocusSessionEntity> = emptyList(),
    val xpEvents: List<XpEventEntity> = emptyList(),
    val achievements: List<AchievementEntity> = emptyList(),
    val streakFreezes: List<StreakFreezeEntity> = emptyList(),
) {
    /** Number of records (rows + prefs groups) — the value BackupManager returns. */
    val recordCount: Int
        get() = categories.size + tasks.size + dependencies.size + subTasks.size + occurrences.size +
            history.size + blockedApps.size + focusSessions.size + xpEvents.size + achievements.size +
            streakFreezes.size + listOfNotNull(settings, blockerConfig, focusConfig).size
}

/** Validation failure. [path] names the offending field (e.g. "tasks[3].title") but never echoes user content. */
class BackupFormatException(val reason: Reason, val path: String = "") :
    Exception("Invalid backup: $reason${if (path.isEmpty()) "" else " at $path"}") {
    enum class Reason { TOO_LARGE, MALFORMED_JSON, NOT_A_BACKUP, UNSUPPORTED_SCHEMA_VERSION, LIMIT_EXCEEDED, INVALID_VALUE, BROKEN_REFERENCE, DUPLICATE }
}

/**
 * Pure JSON encode/decode + validation of backups (no Android APIs; covered by JVM tests).
 * Import is strict: any invalid value rejects the whole file, so the DB is never partially replaced.
 */
object BackupCodec {
    const val SCHEMA_VERSION = 1
    const val APP_MARKER = "discipline-os"
    const val MAX_BYTES = 5 * 1024 * 1024

    // Field / collection limits (generous; they exist to bound memory and reject garbage, not to police users).
    const val MAX_ROWS = 100_000
    const val MAX_TASKS = 10_000
    const val MAX_SUBTASKS_PER_TASK = 200
    const val MAX_TITLE = 500
    const val MAX_NOTES = 10_000
    const val MAX_SHORT = 200
    const val MAX_DETAIL = 2_000
    const val MAX_REMINDERS = 10
    const val MAX_REMINDER_OFFSET_MIN = 7 * 24 * 60
    const val MAX_RECURRENCE = 200

    private val json = Json {
        ignoreUnknownKeys = true // forward-compatible within the same schemaVersion
        encodeDefaults = true
        prettyPrint = true
    }
    private val colorRegex = Regex("^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$")
    private val packageRegex = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")

    // ===================== encode =====================

    fun encode(s: BackupSnapshot, exportedAt: Instant): String {
        val subsByTask = s.subTasks.groupBy { it.taskId }
        val depsByTask = s.dependencies.groupBy({ it.taskId }, { it.dependsOnTaskId })
        val doc = BackupDocumentDto(
            schemaVersion = SCHEMA_VERSION,
            app = APP_MARKER,
            exportedAt = exportedAt.toString(),
            settings = s.settings?.let {
                SettingsDto(
                    language = it.language.name,
                    onboardingCompleted = it.onboardingCompleted,
                    notificationsEnabled = it.notificationsEnabled,
                    dailyPlanningTime = it.dailyPlanningTime.toString(),
                    weekStart = it.weekStart.name,
                    reduceMotion = it.reduceMotion,
                    highContrast = it.highContrast,
                )
            },
            blockerConfig = s.blockerConfig?.let {
                BlockerConfigBackupDto(
                    enabled = it.enabled,
                    carryOverOverdue = it.carryOverOverdue,
                    blockDuringFocus = it.blockDuringFocus,
                    bypassDurationMinutes = it.bypassDurationMinutes,
                    maxBypassesPerDay = it.maxBypassesPerDay,
                    bypassCooldownMinutes = it.bypassCooldownMinutes,
                    recoveryUntil = it.recoveryUntil?.toString(),
                    userExemptPackages = it.userExemptPackages.sorted(),
                )
            },
            focusConfig = s.focusConfig?.let {
                FocusConfigBackupDto(
                    it.workMinutes, it.shortBreakMinutes, it.longBreakMinutes,
                    it.sessionsBeforeLongBreak, it.autoStartBreaks, it.autoStartWork,
                )
            },
            categories = s.categories.map { CategoryDto(it.id, it.name, it.colorHex, it.iconKey) },
            tasks = s.tasks.map { t ->
                TaskDto(
                    id = t.id, title = t.title, notes = t.notes, kind = t.kind, priority = t.priority,
                    categoryId = t.categoryId, startDate = t.startDate.toString(), dueTime = t.dueTime?.toString(),
                    endDate = t.endDate?.toString(), zoneId = t.zoneId, recurrence = t.recurrence,
                    reminderOffsetsMinutes = ReminderOffsetsCodec.decode(t.reminderOffsets),
                    estimatedMinutes = t.estimatedMinutes, verification = t.verification,
                    dependsOn = depsByTask[t.id].orEmpty().sorted(), archived = t.archived,
                    createdAt = t.createdAt.toString(), updatedAt = t.updatedAt.toString(),
                    subTasks = subsByTask[t.id].orEmpty().sortedBy { it.position }
                        .map { SubTaskDto(it.id, it.title, it.done, it.position) },
                )
            },
            occurrences = s.occurrences.map { o ->
                OccurrenceDto(
                    id = o.id, taskId = o.taskId, localDate = o.localDate.toString(), dueAt = o.dueAt?.toString(),
                    status = o.status, completedAt = o.completedAt?.toString(), snoozedUntil = o.snoozedUntil?.toString(),
                    snoozeCount = o.snoozeCount, verificationNote = o.verificationNote,
                )
            },
            history = s.history.map { HistoryDto(it.id, it.taskId, it.occurrenceId, it.type, it.at.toString(), it.detail) },
            blockedApps = s.blockedApps.map { BlockedAppDto(it.packageName, it.label, it.enabled, it.suggestedByDefault) },
            focusSessions = s.focusSessions.map {
                FocusSessionDto(
                    it.id, it.taskId, it.startedAt.toString(), it.endedAt?.toString(),
                    it.plannedSeconds, it.focusedSeconds, it.completed, it.interruptions,
                )
            },
            xpEvents = s.xpEvents.map { XpEventDto(it.id, it.at.toString(), it.amount, it.source, it.dedupeKey) },
            achievements = s.achievements.map { AchievementDto(it.id, it.unlockedAt.toString()) },
            streakFreezes = s.streakFreezes.map { StreakFreezeDto(it.id, it.localDate.toString(), it.usedAt.toString()) },
        )
        return json.encodeToString(BackupDocumentDto.serializer(), doc)
    }

    // ===================== decode + validate =====================

    /** @throws BackupFormatException for any problem. Never returns a partially valid snapshot. */
    fun decode(text: String): BackupSnapshot {
        // Char count is a lower bound for UTF-8 bytes; the byte cap itself is enforced while reading the stream.
        if (text.length > MAX_BYTES) throw BackupFormatException(BackupFormatException.Reason.TOO_LARGE)
        val doc = try {
            json.decodeFromString(BackupDocumentDto.serializer(), text)
        } catch (e: SerializationException) {
            throw BackupFormatException(BackupFormatException.Reason.MALFORMED_JSON)
        } catch (e: IllegalArgumentException) {
            throw BackupFormatException(BackupFormatException.Reason.MALFORMED_JSON)
        }
        return Validator().validate(doc)
    }

    private class Validator {
        private fun fail(reason: BackupFormatException.Reason, path: String): Nothing = throw BackupFormatException(reason, path)
        private fun invalid(path: String): Nothing = fail(BackupFormatException.Reason.INVALID_VALUE, path)

        private fun str(v: String, path: String, max: Int, allowBlank: Boolean = true): String {
            if (v.length > max) fail(BackupFormatException.Reason.LIMIT_EXCEEDED, path)
            if (!allowBlank && v.isBlank()) invalid(path)
            return v
        }

        private fun instant(v: String, path: String): Instant = try { Instant.parse(v) } catch (e: DateTimeException) { invalid(path) }
        private fun date(v: String, path: String): LocalDate = try { LocalDate.parse(v) } catch (e: DateTimeException) { invalid(path) }
        private fun time(v: String, path: String): LocalTime = try { LocalTime.parse(v) } catch (e: DateTimeException) { invalid(path) }
        private fun id(v: Long, path: String): Long = if (v > 0) v else invalid(path)
        private fun range(v: Int, r: IntRange, path: String): Int = if (v in r) v else invalid(path)
        private fun count(size: Int, max: Int, path: String) {
            if (size > max) fail(BackupFormatException.Reason.LIMIT_EXCEEDED, path)
        }
        private inline fun <reified E : Enum<E>> enumName(v: String, path: String): String =
            if (enumValues<E>().any { it.name == v }) v else invalid(path)
        private fun <T> unique(items: List<T>, path: String, key: (T) -> Any) {
            val seen = HashSet<Any>(items.size * 2)
            items.forEachIndexed { i, item -> if (!seen.add(key(item))) fail(BackupFormatException.Reason.DUPLICATE, "$path[$i]") }
        }

        fun validate(d: BackupDocumentDto): BackupSnapshot {
            if (d.app != APP_MARKER) fail(BackupFormatException.Reason.NOT_A_BACKUP, "app")
            if (d.schemaVersion != SCHEMA_VERSION) fail(BackupFormatException.Reason.UNSUPPORTED_SCHEMA_VERSION, "schemaVersion")
            instant(d.exportedAt, "exportedAt")

            count(d.categories.size, MAX_ROWS, "categories")
            count(d.tasks.size, MAX_TASKS, "tasks")
            count(d.occurrences.size, MAX_ROWS, "occurrences")
            count(d.history.size, MAX_ROWS, "history")
            count(d.blockedApps.size, MAX_ROWS, "blockedApps")
            count(d.focusSessions.size, MAX_ROWS, "focusSessions")
            count(d.xpEvents.size, MAX_ROWS, "xpEvents")
            count(d.achievements.size, MAX_ROWS, "achievements")
            count(d.streakFreezes.size, MAX_ROWS, "streakFreezes")

            val settings = d.settings?.let { s ->
                AppSettings(
                    language = AppLanguage.valueOf(enumName<AppLanguage>(s.language, "settings.language")),
                    onboardingCompleted = s.onboardingCompleted,
                    notificationsEnabled = s.notificationsEnabled,
                    dailyPlanningTime = time(s.dailyPlanningTime, "settings.dailyPlanningTime"),
                    weekStart = DayOfWeek.valueOf(enumName<DayOfWeek>(s.weekStart, "settings.weekStart")),
                    reduceMotion = s.reduceMotion,
                    highContrast = s.highContrast,
                )
            }
            val blocker = d.blockerConfig?.let { b ->
                count(b.userExemptPackages.size, 500, "blockerConfig.userExemptPackages")
                b.userExemptPackages.forEachIndexed { i, p -> pkg(p, "blockerConfig.userExemptPackages[$i]") }
                BlockerConfig(
                    enabled = b.enabled,
                    carryOverOverdue = b.carryOverOverdue,
                    blockDuringFocus = b.blockDuringFocus,
                    bypassDurationMinutes = range(b.bypassDurationMinutes, 1..240, "blockerConfig.bypassDurationMinutes"),
                    maxBypassesPerDay = range(b.maxBypassesPerDay, 0..100, "blockerConfig.maxBypassesPerDay"),
                    bypassCooldownMinutes = range(b.bypassCooldownMinutes, 0..1440, "blockerConfig.bypassCooldownMinutes"),
                    recoveryUntil = b.recoveryUntil?.let { instant(it, "blockerConfig.recoveryUntil") },
                    userExemptPackages = b.userExemptPackages.toSet(),
                )
            }
            val focus = d.focusConfig?.let { f ->
                FocusConfig(
                    workMinutes = range(f.workMinutes, 1..240, "focusConfig.workMinutes"),
                    shortBreakMinutes = range(f.shortBreakMinutes, 1..120, "focusConfig.shortBreakMinutes"),
                    longBreakMinutes = range(f.longBreakMinutes, 1..240, "focusConfig.longBreakMinutes"),
                    sessionsBeforeLongBreak = range(f.sessionsBeforeLongBreak, 1..20, "focusConfig.sessionsBeforeLongBreak"),
                    autoStartBreaks = f.autoStartBreaks,
                    autoStartWork = f.autoStartWork,
                )
            }

            // ---- categories ----
            unique(d.categories, "categories") { it.id }
            val categories = d.categories.mapIndexed { i, c ->
                val p = "categories[$i]"
                if (!colorRegex.matches(c.colorHex)) invalid("$p.colorHex")
                CategoryEntity(id(c.id, "$p.id"), str(c.name, "$p.name", 100, allowBlank = false), c.colorHex, str(c.iconKey, "$p.iconKey", 64))
            }
            val categoryIds = categories.mapTo(HashSet()) { it.id }

            // ---- tasks (+ sub-tasks, dependencies) ----
            unique(d.tasks, "tasks") { it.id }
            val taskIds = d.tasks.mapTo(HashSet()) { it.id }
            val subTasks = ArrayList<SubTaskEntity>()
            val deps = ArrayList<TaskDependencyEntity>()
            val tasks = d.tasks.mapIndexed { i, t ->
                val p = "tasks[$i]"
                val tid = id(t.id, "$p.id")
                if (t.categoryId != null && t.categoryId !in categoryIds) fail(BackupFormatException.Reason.BROKEN_REFERENCE, "$p.categoryId")
                val start = date(t.startDate, "$p.startDate")
                val end = t.endDate?.let { date(it, "$p.endDate") }
                if (end != null && end.isBefore(start)) invalid("$p.endDate")
                try { ZoneId.of(t.zoneId) } catch (e: DateTimeException) { invalid("$p.zoneId") }
                count(t.reminderOffsetsMinutes.size, MAX_REMINDERS, "$p.reminderOffsetsMinutes")
                t.reminderOffsetsMinutes.forEachIndexed { j, m -> range(m, 0..MAX_REMINDER_OFFSET_MIN, "$p.reminderOffsetsMinutes[$j]") }
                t.estimatedMinutes?.let { range(it, 1..1440, "$p.estimatedMinutes") }
                count(t.subTasks.size, MAX_SUBTASKS_PER_TASK, "$p.subTasks")
                count(t.dependsOn.size, MAX_TASKS, "$p.dependsOn")
                t.dependsOn.distinct().forEachIndexed { j, dep ->
                    if (dep == tid || dep !in taskIds) fail(BackupFormatException.Reason.BROKEN_REFERENCE, "$p.dependsOn[$j]")
                    deps += TaskDependencyEntity(tid, dep)
                }
                t.subTasks.forEachIndexed { j, s ->
                    val sp = "$p.subTasks[$j]"
                    subTasks += SubTaskEntity(id(s.id, "$sp.id"), tid, str(s.title, "$sp.title", MAX_TITLE, allowBlank = false), s.done, range(s.position, 0..10_000, "$sp.position"))
                }
                TaskEntity(
                    id = tid,
                    title = str(t.title, "$p.title", MAX_TITLE, allowBlank = false),
                    notes = str(t.notes, "$p.notes", MAX_NOTES),
                    kind = enumName<TaskKind>(t.kind, "$p.kind"),
                    priority = enumName<Priority>(t.priority, "$p.priority"),
                    categoryId = t.categoryId,
                    startDate = start,
                    dueTime = t.dueTime?.let { time(it, "$p.dueTime") },
                    endDate = end,
                    zoneId = str(t.zoneId, "$p.zoneId", 64),
                    recurrence = str(t.recurrence, "$p.recurrence", MAX_RECURRENCE),
                    reminderOffsets = ReminderOffsetsCodec.encode(t.reminderOffsetsMinutes),
                    estimatedMinutes = t.estimatedMinutes,
                    verification = enumName<VerificationMethod>(t.verification, "$p.verification"),
                    archived = t.archived,
                    createdAt = instant(t.createdAt, "$p.createdAt"),
                    updatedAt = instant(t.updatedAt, "$p.updatedAt"),
                )
            }
            count(subTasks.size, MAX_ROWS, "tasks[].subTasks")
            unique(subTasks, "tasks[].subTasks") { it.id }

            // ---- occurrences ----
            unique(d.occurrences, "occurrences") { it.id }
            val occurrences = d.occurrences.mapIndexed { i, o ->
                val p = "occurrences[$i]"
                if (o.taskId !in taskIds) fail(BackupFormatException.Reason.BROKEN_REFERENCE, "$p.taskId")
                TaskOccurrenceEntity(
                    id = id(o.id, "$p.id"),
                    taskId = o.taskId,
                    localDate = date(o.localDate, "$p.localDate"),
                    dueAt = o.dueAt?.let { instant(it, "$p.dueAt") },
                    status = enumName<OccurrenceStatus>(o.status, "$p.status"),
                    completedAt = o.completedAt?.let { instant(it, "$p.completedAt") },
                    snoozedUntil = o.snoozedUntil?.let { instant(it, "$p.snoozedUntil") },
                    snoozeCount = range(o.snoozeCount, 0..10_000, "$p.snoozeCount"),
                    verificationNote = o.verificationNote?.let { str(it, "$p.verificationNote", MAX_NOTES) },
                )
            }
            unique(occurrences, "occurrences") { it.taskId to it.localDate }

            // ---- history (taskId may reference a deleted task: no FK, by design) ----
            unique(d.history, "history") { it.id }
            val history = d.history.mapIndexed { i, h ->
                val p = "history[$i]"
                TaskHistoryEntity(
                    id = id(h.id, "$p.id"),
                    taskId = id(h.taskId, "$p.taskId"),
                    occurrenceId = h.occurrenceId?.let { id(it, "$p.occurrenceId") },
                    type = enumName<TaskHistoryType>(h.type, "$p.type"),
                    at = instant(h.at, "$p.at"),
                    detail = str(h.detail, "$p.detail", MAX_DETAIL),
                )
            }

            // ---- blocked apps ----
            unique(d.blockedApps, "blockedApps") { it.packageName }
            val blockedApps = d.blockedApps.mapIndexed { i, a ->
                val p = "blockedApps[$i]"
                BlockedAppEntity(pkg(a.packageName, "$p.packageName"), str(a.label, "$p.label", MAX_SHORT), a.enabled, a.suggestedByDefault)
            }

            // ---- focus sessions ----
            unique(d.focusSessions, "focusSessions") { it.id }
            val focusSessions = d.focusSessions.mapIndexed { i, f ->
                val p = "focusSessions[$i]"
                if (f.plannedSeconds !in 0..86_400L) invalid("$p.plannedSeconds")
                if (f.focusedSeconds !in 0..86_400L) invalid("$p.focusedSeconds")
                FocusSessionEntity(
                    id = id(f.id, "$p.id"),
                    taskId = f.taskId,
                    startedAt = instant(f.startedAt, "$p.startedAt"),
                    endedAt = f.endedAt?.let { instant(it, "$p.endedAt") },
                    plannedSeconds = f.plannedSeconds,
                    focusedSeconds = f.focusedSeconds,
                    completed = f.completed,
                    interruptions = range(f.interruptions, 0..10_000, "$p.interruptions"),
                )
            }

            // ---- gamification ----
            unique(d.xpEvents, "xpEvents") { it.id }
            unique(d.xpEvents, "xpEvents") { it.dedupeKey }
            val xpEvents = d.xpEvents.mapIndexed { i, x ->
                val p = "xpEvents[$i]"
                XpEventEntity(
                    id = id(x.id, "$p.id"),
                    at = instant(x.at, "$p.at"),
                    amount = range(x.amount, -100_000..100_000, "$p.amount"),
                    source = enumName<XpSource>(x.source, "$p.source"),
                    dedupeKey = str(x.dedupeKey, "$p.dedupeKey", MAX_SHORT, allowBlank = false),
                )
            }
            unique(d.achievements, "achievements") { it.id }
            val achievements = d.achievements.mapIndexed { i, a ->
                val p = "achievements[$i]"
                AchievementEntity(str(a.id, "$p.id", 100, allowBlank = false), instant(a.unlockedAt, "$p.unlockedAt"))
            }
            unique(d.streakFreezes, "streakFreezes") { it.id }
            unique(d.streakFreezes, "streakFreezes") { it.localDate }
            val freezes = d.streakFreezes.mapIndexed { i, f ->
                val p = "streakFreezes[$i]"
                StreakFreezeEntity(id(f.id, "$p.id"), date(f.localDate, "$p.localDate"), instant(f.usedAt, "$p.usedAt"))
            }

            return BackupSnapshot(
                settings = settings,
                blockerConfig = blocker,
                focusConfig = focus,
                categories = categories,
                tasks = tasks,
                dependencies = deps,
                subTasks = subTasks,
                occurrences = occurrences,
                history = history,
                blockedApps = blockedApps,
                focusSessions = focusSessions,
                xpEvents = xpEvents,
                achievements = achievements,
                streakFreezes = freezes,
            )
        }

        private fun pkg(v: String, path: String): String {
            if (v.length > 255 || !packageRegex.matches(v)) invalid(path)
            return v
        }
    }
}
