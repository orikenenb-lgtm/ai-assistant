package com.disciplineos.app.data.repository

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.room.withTransaction
import com.disciplineos.app.data.local.DisciplineDatabase
import com.disciplineos.app.data.local.dao.BlockerDao
import com.disciplineos.app.data.local.dao.ChatDao
import com.disciplineos.app.data.local.dao.FocusDao
import com.disciplineos.app.data.local.dao.GamificationDao
import com.disciplineos.app.data.local.entity.AchievementEntity
import com.disciplineos.app.data.local.entity.StreakFreezeEntity
import com.disciplineos.app.data.mapper.toEntity
import com.disciplineos.app.data.mapper.toModel
import com.disciplineos.app.data.prefs.PrefKeys
import com.disciplineos.app.data.prefs.PrefsCodec
import com.disciplineos.app.data.prefs.safeData
import com.disciplineos.app.di.IoDispatcher
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.ChatRepository
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.GamificationRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.Achievement
import com.disciplineos.core.model.BlockedApp
import com.disciplineos.core.model.BlockerConfig
import com.disciplineos.core.model.BypassSession
import com.disciplineos.core.model.ChatMessage
import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.FocusSession
import com.disciplineos.core.model.FocusState
import com.disciplineos.core.model.XpEvent
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

/** Blocker config lives in DataStore (JSON); blocked apps and the bypass log live in Room. */
@Singleton
class BlockerRepositoryImpl @Inject constructor(
    private val db: DisciplineDatabase,
    private val dao: BlockerDao,
    private val dataStore: DataStore<Preferences>,
    @IoDispatcher private val io: CoroutineDispatcher,
) : BlockerRepository {

    override fun observeConfig(): Flow<BlockerConfig> =
        dataStore.safeData().map { PrefsCodec.decodeBlockerConfig(it[PrefKeys.BLOCKER_CONFIG_JSON]) }.distinctUntilChanged()

    override fun observeBlockedApps(): Flow<List<BlockedApp>> =
        dao.observeBlockedApps().map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override fun observeBypasses(since: Instant): Flow<List<BypassSession>> =
        dao.observeBypasses(since).map { rows -> rows.map { it.toModel() } }.flowOn(io)

    /** Read-modify-write is atomic: DataStore serialises `edit` blocks. */
    override suspend fun updateConfig(transform: (BlockerConfig) -> BlockerConfig) {
        dataStore.edit { prefs ->
            val next = transform(PrefsCodec.decodeBlockerConfig(prefs[PrefKeys.BLOCKER_CONFIG_JSON]))
            prefs[PrefKeys.BLOCKER_CONFIG_JSON] = PrefsCodec.encodeBlockerConfig(next)
        }
    }

    override suspend fun setBlockedApps(apps: List<BlockedApp>) {
        db.withTransaction {
            dao.deleteAllBlockedApps()
            dao.insertBlockedApps(apps.distinctBy { it.packageName }.map { it.toEntity() })
        }
    }

    override suspend fun setAppEnabled(packageName: String, enabled: Boolean) {
        dao.setAppEnabled(packageName, enabled)
    }

    override suspend fun insertBypass(session: BypassSession): Long = dao.insertBypass(session.toEntity().copy(id = 0))

    override suspend fun endBypassEarly(id: Long, at: Instant) {
        dao.endBypassEarly(id, at)
    }
}

/** Focus config + live timer state in DataStore (JSON); completed/abandoned sessions in Room. */
@Singleton
class FocusRepositoryImpl @Inject constructor(
    private val dao: FocusDao,
    private val dataStore: DataStore<Preferences>,
    @IoDispatcher private val io: CoroutineDispatcher,
) : FocusRepository {

    override fun observeConfig(): Flow<FocusConfig> =
        dataStore.safeData().map { PrefsCodec.decodeFocusConfig(it[PrefKeys.FOCUS_CONFIG_JSON]) }.distinctUntilChanged()

    override fun observeSessions(since: Instant): Flow<List<FocusSession>> =
        dao.observeSessions(since).map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override suspend fun updateConfig(transform: (FocusConfig) -> FocusConfig) {
        dataStore.edit { prefs ->
            val next = transform(PrefsCodec.decodeFocusConfig(prefs[PrefKeys.FOCUS_CONFIG_JSON]))
            prefs[PrefKeys.FOCUS_CONFIG_JSON] = PrefsCodec.encodeFocusConfig(next)
        }
    }

    override suspend fun insertSession(session: FocusSession): Long = dao.insertSession(session.toEntity().copy(id = 0))

    override suspend fun updateSession(session: FocusSession) {
        dao.updateSession(session.toEntity())
    }

    override suspend fun saveRunningState(state: FocusState?) {
        dataStore.edit { prefs ->
            if (state == null) {
                prefs.remove(PrefKeys.FOCUS_RUNNING_STATE_JSON)
            } else {
                prefs[PrefKeys.FOCUS_RUNNING_STATE_JSON] = PrefsCodec.encodeFocusState(state)
            }
        }
    }

    override suspend fun loadRunningState(): FocusState? =
        PrefsCodec.decodeFocusState(dataStore.safeData().first()[PrefKeys.FOCUS_RUNNING_STATE_JSON])
}

@Singleton
class GamificationRepositoryImpl @Inject constructor(
    private val dao: GamificationDao,
    private val time: TimeProvider,
    @IoDispatcher private val io: CoroutineDispatcher,
) : GamificationRepository {

    override fun observeXpEvents(): Flow<List<XpEvent>> =
        dao.observeXpEvents().map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override fun observeAchievements(): Flow<List<Achievement>> =
        dao.observeAchievements().map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override suspend fun awardXp(event: XpEvent): Boolean = dao.insertXpEvent(event.toEntity().copy(id = 0)) != -1L

    override suspend fun unlockAchievement(id: String, at: Instant): Boolean =
        dao.insertAchievement(AchievementEntity(id = id, unlockedAt = at)) != -1L

    override suspend fun streakFreezesUsed(): Int = dao.countStreakFreezes()

    /** Idempotent per date (unique index on localDate). */
    override suspend fun recordStreakFreezeUsed(date: LocalDate) {
        dao.insertStreakFreeze(StreakFreezeEntity(localDate = date, usedAt = time.now()))
    }
}

@Singleton
class ChatRepositoryImpl @Inject constructor(
    private val dao: ChatDao,
    @IoDispatcher private val io: CoroutineDispatcher,
) : ChatRepository {

    override fun observeMessages(): Flow<List<ChatMessage>> =
        dao.observeMessages().map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override suspend fun insertMessage(message: ChatMessage): Long = dao.insertMessage(message.toEntity().copy(id = 0))

    override suspend fun updateMessage(message: ChatMessage) {
        dao.updateMessage(message.toEntity())
    }

    override suspend fun countUserMessagesSince(since: Instant): Int = dao.countUserMessagesSince(since)

    override suspend fun clear() {
        dao.clear()
    }
}
