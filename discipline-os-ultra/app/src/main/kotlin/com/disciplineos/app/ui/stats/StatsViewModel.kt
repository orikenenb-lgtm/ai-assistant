package com.disciplineos.app.ui.stats

import android.content.Context
import android.content.pm.PackageManager
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.core.domain.repository.ScreenTimeSource
import com.disciplineos.core.domain.stats.ObserveStatisticsUseCase
import com.disciplineos.core.domain.stats.StatsRange
import com.disciplineos.core.domain.stats.StatsSnapshot
import com.disciplineos.core.domain.time.TimeProvider
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

sealed interface StatsLoad {
    data object Loading : StatsLoad
    data class Ready(val snapshot: StatsSnapshot) : StatsLoad
    data object Empty : StatsLoad
    data object Error : StatsLoad
}

data class AppUsageRow(val packageName: String, val label: String, val minutes: Long)

sealed interface ScreenTimeUi {
    data object Loading : ScreenTimeUi
    data object NoPermission : ScreenTimeUi
    data object Unavailable : ScreenTimeUi
    data class Ready(val totalMinutes: Long, val top: List<AppUsageRow>) : ScreenTimeUi
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class StatsViewModel @Inject constructor(
    private val observeStatistics: ObserveStatisticsUseCase,
    private val screenTime: ScreenTimeSource,
    private val time: TimeProvider,
    @ApplicationContext private val context: Context,
) : ViewModel() {

    private val _range = MutableStateFlow(StatsRange.WEEK)
    val range: StateFlow<StatsRange> = _range.asStateFlow()

    private val retry = MutableStateFlow(0)

    val stats: StateFlow<StatsLoad> = _range.flatMapLatest { r ->
        retry.flatMapLatest {
            observeStatistics(r)
                .map<StatsSnapshot, StatsLoad> { s -> if (s.days.all { it.total == 0 && it.focusMinutes == 0 }) StatsLoad.Empty else StatsLoad.Ready(s) }
                .onStart { emit(StatsLoad.Loading) }
                .catch { emit(StatsLoad.Error) }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), StatsLoad.Loading)

    private val _screenTime = MutableStateFlow<ScreenTimeUi>(ScreenTimeUi.Loading)
    val screenTimeUi: StateFlow<ScreenTimeUi> = _screenTime.asStateFlow()

    fun selectRange(range: StatsRange) {
        _range.value = range
    }

    fun retry() {
        retry.value += 1
    }

    /** Called on every ON_RESUME: usage access may have been granted/revoked in system settings meanwhile. */
    fun refreshScreenTime() {
        viewModelScope.launch {
            if (!screenTime.hasPermission()) {
                _screenTime.value = ScreenTimeUi.NoPermission
                return@launch
            }
            if (_screenTime.value !is ScreenTimeUi.Ready) _screenTime.value = ScreenTimeUi.Loading
            val usage = runCatching { screenTime.usageForDay(time.today()) }.getOrNull()
            if (usage == null) {
                _screenTime.value = ScreenTimeUi.Unavailable
                return@launch
            }
            val minutesByPackage = usage
                .filterKeys { it != context.packageName }
                .mapValues { it.value.toMinutes() }
            val top = ChartMath.topN(minutesByPackage, 5)
            val rows = withContext(Dispatchers.IO) {
                top.map { (pkg, minutes) -> AppUsageRow(pkg, labelFor(pkg), minutes) }
            }
            _screenTime.value = ScreenTimeUi.Ready(totalMinutes = minutesByPackage.values.sum(), top = rows)
        }
    }

    private fun labelFor(packageName: String): String {
        val pm = context.packageManager
        return try {
            @Suppress("DEPRECATION")
            pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
        } catch (_: PackageManager.NameNotFoundException) {
            // Not visible under package-visibility rules (no QUERY_ALL_PACKAGES) → show the package name.
            packageName
        }
    }
}
