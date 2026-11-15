package ai.noa.bridge.app.ui.components

import ai.noa.bridge.app.R
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.res.stringResource
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * "Now" for relative timestamps. The root provides a value that ticks every 30 seconds so labels
 * like "לפני 2 דקות" stay fresh without per-item timers. 0 = read the system clock.
 */
val LocalNowMillis = compositionLocalOf { 0L }

@Composable
fun currentNowMillis(): Long = LocalNowMillis.current.takeIf { it > 0L } ?: System.currentTimeMillis()

private val HebrewLocale: Locale = Locale.forLanguageTag("he-IL")
private val TimeFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", HebrewLocale)
private val DateFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("d.M.yy, HH:mm", HebrewLocale)

fun formatClockTime(millis: Long, zone: ZoneId = ZoneId.systemDefault()): String =
    TimeFormatter.format(Instant.ofEpochMilli(millis).atZone(zone))

/** Pure classification so it can be unit tested without Compose. */
sealed interface RelativeTime {
    data object JustNow : RelativeTime
    data class Minutes(val n: Long) : RelativeTime
    data class Hours(val n: Long) : RelativeTime
    data class Yesterday(val clock: String) : RelativeTime
    data class Absolute(val text: String) : RelativeTime
}

fun classifyRelativeTime(nowMillis: Long, thenMillis: Long, zone: ZoneId = ZoneId.systemDefault()): RelativeTime {
    val diff = (nowMillis - thenMillis).coerceAtLeast(0L)
    val minutes = diff / 60_000L
    val hours = diff / 3_600_000L
    val nowDate = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
    val thenZoned = Instant.ofEpochMilli(thenMillis).atZone(zone)
    val thenDate: LocalDate = thenZoned.toLocalDate()
    return when {
        minutes < 1 -> RelativeTime.JustNow
        minutes < 60 -> RelativeTime.Minutes(minutes)
        hours < 12 && thenDate == nowDate -> RelativeTime.Hours(hours)
        thenDate == nowDate -> RelativeTime.Absolute(TimeFormatter.format(thenZoned))
        thenDate == nowDate.minusDays(1) -> RelativeTime.Yesterday(TimeFormatter.format(thenZoned))
        else -> RelativeTime.Absolute(DateFormatter.format(thenZoned))
    }
}

@Composable
fun relativeTimeLabel(thenMillis: Long): String =
    when (val r = classifyRelativeTime(currentNowMillis(), thenMillis)) {
        RelativeTime.JustNow -> stringResource(R.string.time_just_now)
        is RelativeTime.Minutes -> if (r.n == 1L) stringResource(R.string.time_one_minute) else stringResource(R.string.time_minutes, r.n.toInt())
        is RelativeTime.Hours -> when (r.n) {
            1L -> stringResource(R.string.time_one_hour)
            2L -> stringResource(R.string.time_two_hours)
            else -> stringResource(R.string.time_hours, r.n.toInt())
        }
        is RelativeTime.Yesterday -> stringResource(R.string.time_yesterday, r.clock)
        is RelativeTime.Absolute -> r.text
    }
