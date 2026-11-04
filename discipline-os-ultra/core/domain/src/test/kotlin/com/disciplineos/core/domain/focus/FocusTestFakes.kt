package com.disciplineos.core.domain.focus

import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.FocusSession
import com.disciplineos.core.model.FocusState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/** Manually advanced clock (shared by blocker + focus tests). */
class MutableTimeProvider(
    var current: Instant,
    private val zoneId: ZoneId = ZoneId.of("Asia/Jerusalem"),
) : TimeProvider {
    override fun now(): Instant = current
    override fun zone(): ZoneId = zoneId
    fun advance(d: Duration) {
        current = current.plus(d)
    }
    fun advanceMinutes(m: Long) = advance(Duration.ofMinutes(m))
}

class FakeFocusRepository(config: FocusConfig = FocusConfig()) : FocusRepository {
    val config = MutableStateFlow(config)
    val sessions = MutableStateFlow<List<FocusSession>>(emptyList())
    var savedState: FocusState? = null
    var saveCount = 0
    private var nextId = 1L

    override fun observeConfig(): Flow<FocusConfig> = config
    override fun observeSessions(since: Instant): Flow<List<FocusSession>> =
        sessions.map { list -> list.filter { !it.startedAt.isBefore(since) } }

    override suspend fun updateConfig(transform: (FocusConfig) -> FocusConfig) = config.update(transform)

    override suspend fun insertSession(session: FocusSession): Long {
        val id = nextId++
        sessions.update { it + session.copy(id = id) }
        return id
    }

    override suspend fun updateSession(session: FocusSession) {
        sessions.update { list -> list.map { if (it.id == session.id) session else it } }
    }

    override suspend fun saveRunningState(state: FocusState?) {
        savedState = state
        saveCount++
    }

    override suspend fun loadRunningState(): FocusState? = savedState
}
