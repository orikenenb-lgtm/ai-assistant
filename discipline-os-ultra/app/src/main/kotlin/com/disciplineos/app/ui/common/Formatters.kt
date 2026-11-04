package com.disciplineos.app.ui.common

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import com.disciplineos.app.R
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Locale-aware formatting helpers. Hebrew is the primary locale; date patterns use the Hebrew
 * "ב" month prefix ("4 בנובמבר"). Times are 24h, as is standard in Israel.
 */
object Formatters {
    private val HebrewLanguages = setOf("he", "iw")

    fun isHebrew(locale: Locale): Boolean = locale.language in HebrewLanguages

    /** "יום רביעי, 4 בנובמבר" / "Wednesday, November 4". */
    fun fullDate(date: LocalDate, locale: Locale): String {
        val pattern = if (isHebrew(locale)) "EEEE, d 'ב'MMMM" else "EEEE, MMMM d"
        return DateTimeFormatter.ofPattern(pattern, locale).format(date)
    }

    /** "4 בנוב׳" / "Nov 4". */
    fun shortDate(date: LocalDate, locale: Locale): String {
        val pattern = if (isHebrew(locale)) "d 'ב'MMM" else "MMM d"
        return DateTimeFormatter.ofPattern(pattern, locale).format(date)
    }

    /** "4.11" — compact numeric day.month used in dense grids. */
    fun numericDayMonth(date: LocalDate): String = "${date.dayOfMonth}.${date.monthValue}"

    fun time(time: LocalTime): String = DateTimeFormatter.ofPattern("HH:mm").format(time)

    fun time(instant: Instant, zone: ZoneId): String = time(instant.atZone(zone).toLocalTime())

    /** "4 בנוב׳, 14:30". */
    fun dateTime(instant: Instant, zone: ZoneId, locale: Locale): String {
        val zoned = instant.atZone(zone)
        return "${shortDate(zoned.toLocalDate(), locale)}, ${time(zoned.toLocalTime())}"
    }

    /** Narrow weekday ("א׳" in Hebrew, "S" in English). */
    fun narrowDay(day: DayOfWeek, locale: Locale): String = day.getDisplayName(TextStyle.NARROW, locale)

    /** Full weekday ("יום ראשון"). */
    fun fullDay(day: DayOfWeek, locale: Locale): String = day.getDisplayName(TextStyle.FULL, locale)

    /** Short weekday ("יום א׳" / "Sun"). */
    fun shortDay(day: DayOfWeek, locale: Locale): String = day.getDisplayName(TextStyle.SHORT, locale)

    /** Greeting that matches the hour of day. */
    @StringRes
    fun greetingRes(hour: Int): Int = when (hour) {
        in 5..11 -> R.string.core_greeting_morning
        in 12..16 -> R.string.core_greeting_afternoon
        in 17..20 -> R.string.core_greeting_evening
        else -> R.string.core_greeting_night
    }
}

/** Current UI locale (follows per-app language settings). */
@Composable
@ReadOnlyComposable
fun currentLocale(): Locale {
    val locales = LocalConfiguration.current.locales
    return if (locales.isEmpty) Locale.getDefault() else locales[0]
}

/** "היום" / "מחר" / "אתמול" / weekday within the coming week / short date. */
@Composable
fun relativeDayLabel(date: LocalDate, today: LocalDate): String {
    val locale = currentLocale()
    val diff = ChronoUnit.DAYS.between(today, date)
    return when {
        diff == 0L -> stringResource(R.string.core_today)
        diff == 1L -> stringResource(R.string.core_tomorrow)
        diff == -1L -> stringResource(R.string.core_yesterday)
        diff in 2L..6L -> Formatters.fullDay(date.dayOfWeek, locale)
        else -> Formatters.shortDate(date, locale)
    }
}

/** "25 דק׳" / "1 שע׳" / "1 שע׳ 30 דק׳". */
@Composable
fun formatMinutes(totalMinutes: Int): String {
    val minutes = totalMinutes.coerceAtLeast(0)
    val h = minutes / 60
    val m = minutes % 60
    return when {
        h == 0 -> stringResource(R.string.core_duration_minutes, m)
        m == 0 -> stringResource(R.string.core_duration_hours, h)
        else -> stringResource(R.string.core_duration_hours_minutes, h, m)
    }
}

/** Parses a stored category color ("#RRGGBB" / "#AARRGGBB"); malformed values fall back. */
fun parseHexColor(hex: String, fallback: Color): Color =
    try {
        Color(android.graphics.Color.parseColor(hex))
    } catch (e: IllegalArgumentException) {
        fallback
    }

/** "#RRGGBB" for persisting a theme color (e.g. a new category's color). */
fun Color.toHex(): String = String.format(Locale.ROOT, "#%06X", toArgb() and 0xFFFFFF)
