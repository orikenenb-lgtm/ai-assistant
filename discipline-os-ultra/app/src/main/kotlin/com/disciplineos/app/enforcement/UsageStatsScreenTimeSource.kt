package com.disciplineos.app.enforcement

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import com.disciplineos.app.enforcement.ui.PermissionChecks
import com.disciplineos.core.domain.repository.ScreenTimeSource
import com.disciplineos.core.domain.time.TimeProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Duration
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Local-only screen time from UsageStatsManager events for one local day in the system zone.
 * Returns null without usage access (never fakes data). Results are not persisted or sent anywhere by this class.
 */
@Singleton
class UsageStatsScreenTimeSource @Inject constructor(
    @ApplicationContext private val context: Context,
    private val time: TimeProvider,
) : ScreenTimeSource {

    override fun hasPermission(): Boolean = PermissionChecks.hasUsageAccess(context)

    override suspend fun usageForDay(date: LocalDate): Map<String, Duration>? = withContext(Dispatchers.IO) {
        if (!hasPermission()) return@withContext null
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return@withContext null
        val zone = time.zone()
        val start = date.atStartOfDay(zone).toInstant().toEpochMilli()
        val dayEnd = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        val end = minOf(dayEnd, time.now().toEpochMilli())
        if (end <= start) return@withContext emptyMap()
        val samples = try {
            val events = usm.queryEvents(start, end) ?: return@withContext null
            val out = ArrayList<UsageEventSample>(1024)
            val e = UsageEvents.Event()
            while (events.hasNextEvent()) {
                events.getNextEvent(e)
                val type = ForegroundAppDetector.classify(e.eventType)
                if (type == ForegroundEventType.OTHER) continue
                out += UsageEventSample(e.timeStamp, e.packageName ?: continue, type)
            }
            out
        } catch (_: SecurityException) {
            return@withContext null
        } catch (_: IllegalStateException) {
            return@withContext null // user locked (direct boot)
        }
        aggregateForegroundDurations(samples, start, end)
    }
}
