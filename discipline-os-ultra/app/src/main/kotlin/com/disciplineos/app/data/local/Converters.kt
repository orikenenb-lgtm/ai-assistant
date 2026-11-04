package com.disciplineos.app.data.local

import androidx.room.TypeConverter
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

/**
 * Room type converters for java.time.
 *
 * - [Instant]   -> epoch millis (INTEGER). Millisecond precision is enough for every timestamp in the app.
 * - [LocalDate] -> epoch day (INTEGER). Integer days index and range-scan efficiently (`BETWEEN`).
 * - [LocalTime] -> second of day (INTEGER). Sub-second precision is intentionally dropped.
 *
 * Enums are NOT converted here: entities store enum names as TEXT and the mappers parse them with a
 * safe fallback, so an unknown name (e.g. written by a newer app version) never crashes a query.
 */
class Converters {
    @TypeConverter
    fun instantToMillis(value: Instant?): Long? = value?.toEpochMilli()

    @TypeConverter
    fun millisToInstant(value: Long?): Instant? = value?.let(Instant::ofEpochMilli)

    @TypeConverter
    fun localDateToEpochDay(value: LocalDate?): Long? = value?.toEpochDay()

    @TypeConverter
    fun epochDayToLocalDate(value: Long?): LocalDate? = value?.let(LocalDate::ofEpochDay)

    @TypeConverter
    fun localTimeToSecondOfDay(value: LocalTime?): Int? = value?.toSecondOfDay()

    @TypeConverter
    fun secondOfDayToLocalTime(value: Int?): LocalTime? = value?.let { LocalTime.ofSecondOfDay(it.toLong()) }
}
