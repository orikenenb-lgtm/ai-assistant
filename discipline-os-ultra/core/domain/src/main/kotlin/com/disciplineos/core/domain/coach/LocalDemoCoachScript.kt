package com.disciplineos.core.domain.coach

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add
import java.time.LocalDate

/**
 * Deterministic, keyword-based script behind [LocalDemoCoachProvider]. No network, no randomness:
 * the same message + context + date always produce the same reply. All emitted action JSON is built to pass
 * [CoachActionValidator] (create dates are today, reschedule dates tomorrow and only for ids from
 * [CoachContext.pendingTasks], titles <= 120 chars, <= 10 sub-tasks, estimate 1..720).
 */
internal object LocalDemoCoachScript {
    data class Reply(val intent: Intent, val text: String, val actionJson: List<String>)

    enum class Intent { BREAK_DOWN, RESCHEDULE, PLAN_DAY, PRIORITIZE, SUMMARY, MOTIVATION }

    const val DEMO_NOTE = "(מאמן הדגמה לא מקוון)"
    private const val MAX_LISTED = 7

    private val breakDownKeys = listOf("פרק לי", "תפרק", "לפרק", "פירוק", "break down", "breakdown", "break it down")
    private val planKeys = listOf("תכנן", "תכנון", "תוכנית", "לתכנן", "plan my day", "plan")
    private val prioritizeKeys = listOf("מה לעשות קודם", "במה להתחיל", "מה קודם", "עדיפות", "לתעדף", "תעדוף", "priorit", "what first", "what should i do first")
    private val rescheduleKeys = listOf("דחה", "לדחות", "תדחה", "תדחי", "להזיז", "תזיז", "תזיזי", "postpone", "reschedule")
    private val summaryKeys = listOf("סכם", "סיכום", "תסכם", "summary", "summarize", "summarise", "recap")

    fun detect(message: String): Intent {
        val m = message.lowercase()
        return when {
            breakDownKeys.any { it in m } -> Intent.BREAK_DOWN
            rescheduleKeys.any { it in m } -> Intent.RESCHEDULE
            prioritizeKeys.any { it in m } -> Intent.PRIORITIZE
            summaryKeys.any { it in m } -> Intent.SUMMARY
            planKeys.any { it in m } -> Intent.PLAN_DAY
            else -> Intent.MOTIVATION
        }
    }

    fun reply(message: String, context: CoachContext, today: LocalDate): Reply = when (detect(message)) {
        Intent.PLAN_DAY -> planDay(context, today)
        Intent.BREAK_DOWN -> breakDown(message, today)
        Intent.RESCHEDULE -> reschedule(context, today)
        Intent.PRIORITIZE -> prioritize(context)
        Intent.SUMMARY -> summary(context)
        Intent.MOTIVATION -> motivation(message, context)
    }

    private fun planDay(c: CoachContext, today: LocalDate): Reply {
        val lines = buildList {
            c.pendingMandatoryTitles.forEach { add("(חובה) $it") }
            c.pendingOptionalTitles.forEach { add("(רשות) $it") }
        }.take(MAX_LISTED)
        val text = buildString {
            append("$DEMO_NOTE הנה תוכנית מוצעת להיום:\n")
            if (lines.isEmpty()) {
                append("אין משימות פתוחות להיום — זה זמן מצוין לבחור משימה אחת קטנה שתקדם אותך.\n")
            } else {
                lines.forEachIndexed { i, l -> append("${i + 1}. $l\n") }
                append("משימות החובה ראשונות, ואחריהן משימות הרשות. בין משימה למשימה כדאי הפסקה קצרה.\n")
            }
            append("בסוף היום מומלץ להקדיש 10 דקות לסקירה קצרה — הוספתי הצעה שאפשר לאשר או לדחות.")
        }
        val action = createTaskJson(
            title = "סקירה יומית קצרה",
            kind = "OPTIONAL",
            priority = "LOW",
            date = today,
            estimatedMinutes = 10,
            subTasks = listOf("מה הצלחתי היום?", "מה אני לוקח/ת למחר?"),
        )
        return Reply(Intent.PLAN_DAY, text, listOf(action))
    }

    private fun breakDown(message: String, today: LocalDate): Reply {
        var goal = message
        for (k in breakDownKeys) goal = goal.replace(k, " ", ignoreCase = true)
        goal = goal.replace(Regex("""^[\s:,\-–—]*(את|ה?מטרה|goal|my|the|into steps|לצעדים)?[\s:,\-–—]*""", RegexOption.IGNORE_CASE), "")
        goal = PromptInjectionGuard.sanitizeContextField(goal, 80).trim(' ', '.', '?', '!', ':', '-')
        if (goal.isBlank()) goal = "המטרה שלך"
        val steps = listOf(
            "להגדיר במשפט אחד איך נראית הצלחה",
            "לפרק לשלוש אבני דרך קטנות",
            "לבצע את הצעד הראשון ב-15 דקות",
            "לשריין זמן קבוע ביומן להמשך",
            "לבדוק התקדמות בסוף השבוע",
        )
        val text = buildString {
            append("$DEMO_NOTE בוא נפרק את \"$goal\" לצעדים קטנים וברי ביצוע:\n")
            steps.forEachIndexed { i, s -> append("${i + 1}. $s\n") }
            append("הכנתי משימה עם תתי-משימות — היא תיווצר רק אם תאשר.")
        }
        val action = createTaskJson(
            title = "לקדם: $goal",
            kind = "OPTIONAL",
            priority = "MEDIUM",
            date = today,
            estimatedMinutes = 45,
            subTasks = steps,
        )
        return Reply(Intent.BREAK_DOWN, text, listOf(action))
    }

    /**
     * Proposes moving ONE pending task to tomorrow: the oldest overdue mandatory task first, otherwise the first
     * mandatory task of today. Only ids from [CoachContext.pendingTasks] are used, never invented ones.
     */
    private fun reschedule(c: CoachContext, today: LocalDate): Reply {
        val refs = c.pendingTasks.filter { it.mandatory && it.id > 0 }
        fun dateOf(ref: CoachTaskRef): LocalDate? = runCatching { LocalDate.parse(ref.date) }.getOrNull()
        val overdue = refs.filter { dateOf(it)?.isBefore(today) == true }.minByOrNull { dateOf(it)!! }
        val target = overdue ?: refs.firstOrNull { dateOf(it) == today }
        if (target == null) {
            val text = "$DEMO_NOTE אין כרגע משימת חובה פתוחה שאפשר לדחות. אם משהו מרגיש כבד מדי — " +
                "אפשר לבקש ממני \"פרק לי\" ולהתחיל מצעד קטן."
            return Reply(Intent.RESCHEDULE, text, emptyList())
        }
        val newDate = today.plusDays(1)
        val title = PromptInjectionGuard.sanitizeContextField(target.title, 80).ifBlank { "משימת החובה" }
        val text = buildString {
            append("$DEMO_NOTE ")
            if (overdue != null) {
                append("\"$title\" באיחור מאז ${target.date}. ")
            } else {
                append("\"$title\" מתוכננת להיום. ")
            }
            append("אפשר לדחות אותה למחר ($newDate) ולקבוע לה זמן ברור — עדיף מועד ריאלי מאשר עוד יום של אשמה. ")
            append("הכנתי הצעה לדחייה — היא תתבצע רק אם תאשר.")
        }
        val action = buildJsonObject {
            put("type", "reschedule_task")
            put("taskId", target.id)
            put("newDate", newDate.toString())
        }.toString()
        return Reply(Intent.RESCHEDULE, text, listOf(action))
    }

    private fun prioritize(c: CoachContext): Reply {
        val text = when {
            c.pendingMandatoryTitles.isNotEmpty() -> buildString {
                append("$DEMO_NOTE ההמלצה שלי: להתחיל ב\"${c.pendingMandatoryTitles.first()}\" — זו משימת החובה הדחופה ביותר שלך.")
                if (c.pendingMandatoryTitles.size > 1) append(" אחריה: \"${c.pendingMandatoryTitles[1]}\".")
                append(" טיפ: הפעל סשן פוקוס של 25 דקות והתחל בצעד הכי קטן.")
            }
            c.pendingOptionalTitles.isNotEmpty() ->
                "$DEMO_NOTE כל משימות החובה סגורות — כל הכבוד! אפשר להמשיך ל\"${c.pendingOptionalTitles.first()}\"."
            else -> "$DEMO_NOTE אין כרגע משימות פתוחות. אפשר לנוח, או להוסיף משימה אחת קטנה למחר."
        }
        return Reply(Intent.PRIORITIZE, text, emptyList())
    }

    private fun summary(c: CoachContext): Reply {
        val text = buildString {
            append("$DEMO_NOTE סיכום להיום (${c.localDateIso}): ")
            append("השלמת ${c.completedTodayCount} משימות, ")
            append("נותרו ${c.pendingMandatoryTitles.size} משימות חובה פתוחות, ")
            append("צברת ${c.focusMinutesToday} דקות פוקוס, ")
            append("והרצף הנוכחי שלך הוא ${c.streakDays} ימים. ")
            append(
                when {
                    c.pendingMandatoryTitles.isEmpty() && c.completedTodayCount > 0 -> "יום מצוין — אפשר להיות גאה בעצמך."
                    c.completedTodayCount > 0 -> "התקדמות יפה. עוד צעד קטן ומשימות החובה סגורות."
                    else -> "כל התחלה נחשבת — בחר משימה אחת קטנה ותתחיל ממנה."
                },
            )
        }
        return Reply(Intent.SUMMARY, text, emptyList())
    }

    private val motivations = listOf(
        "עקביות קטנה מנצחת מאמץ גדול וחד-פעמי. מה הצעד הכי קטן שאפשר לעשות עכשיו?",
        "לא צריך להרגיש מוכן כדי להתחיל — מספיקות 5 דקות כדי לצבור תנופה.",
        "כל משימה שהושלמה היא הוכחה שאתה מסוגל. בוא נבחר את הבאה.",
        "יום פחות טוב הוא רק נתון, לא הגדרה. מחר מתחילים מחדש.",
    )

    private fun motivation(message: String, c: CoachContext): Reply {
        val idx = Math.floorMod(message.trim().length, motivations.size)
        val text = buildString {
            append("$DEMO_NOTE ")
            append(motivations[idx])
            if (c.streakDays > 0) append(" הרצף שלך עומד על ${c.streakDays} ימים — כל הכבוד.")
            append(" אפשר לבקש ממני: \"תכנן לי את היום\", \"פרק לי מטרה\", \"מה לעשות קודם\", \"דחה משימה\" או \"סכם את היום\".")
        }
        return Reply(Intent.MOTIVATION, text, emptyList())
    }

    private fun createTaskJson(
        title: String,
        kind: String,
        priority: String,
        date: LocalDate,
        estimatedMinutes: Int,
        subTasks: List<String>,
    ): String = buildJsonObject {
        put("type", "create_task")
        put("title", title.take(CoachActionValidator.MAX_TITLE))
        put("kind", kind)
        put("priority", priority)
        put("date", date.toString())
        put("estimatedMinutes", estimatedMinutes)
        putJsonArray("subTasks") { subTasks.take(CoachActionValidator.MAX_SUBTASKS).forEach { add(it) } }
    }.toString()
}
