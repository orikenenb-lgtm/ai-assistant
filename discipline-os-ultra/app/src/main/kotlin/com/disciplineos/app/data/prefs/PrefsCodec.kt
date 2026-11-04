package com.disciplineos.app.data.prefs

import com.disciplineos.app.data.mapper.enumOr
import com.disciplineos.core.model.BlockerConfig
import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.FocusPhase
import com.disciplineos.core.model.FocusState
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant

/**
 * JSON encodings for structured preferences stored as single String entries in DataStore.
 * Pure Kotlin (JVM-testable). Decoding never throws: corrupt/absent values yield defaults (or null for the
 * running focus state), so a bad preference can never brick app start.
 */
object PrefsCodec {
    internal val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    // ---------- BlockerConfig ----------

    @Serializable
    internal data class BlockerConfigDto(
        val enabled: Boolean = false,
        val carryOverOverdue: Boolean = true,
        val blockDuringFocus: Boolean = true,
        val bypassDurationMinutes: Int = 10,
        val maxBypassesPerDay: Int = 3,
        val bypassCooldownMinutes: Int = 30,
        val recoveryUntilEpochMillis: Long? = null,
        val userExemptPackages: List<String> = emptyList(),
    )

    fun encodeBlockerConfig(c: BlockerConfig): String = json.encodeToString(
        BlockerConfigDto.serializer(),
        BlockerConfigDto(
            enabled = c.enabled,
            carryOverOverdue = c.carryOverOverdue,
            blockDuringFocus = c.blockDuringFocus,
            bypassDurationMinutes = c.bypassDurationMinutes,
            maxBypassesPerDay = c.maxBypassesPerDay,
            bypassCooldownMinutes = c.bypassCooldownMinutes,
            recoveryUntilEpochMillis = c.recoveryUntil?.toEpochMilli(),
            userExemptPackages = c.userExemptPackages.sorted(),
        ),
    )

    fun decodeBlockerConfig(value: String?): BlockerConfig {
        if (value.isNullOrBlank()) return BlockerConfig()
        return try {
            val d = json.decodeFromString(BlockerConfigDto.serializer(), value)
            BlockerConfig(
                enabled = d.enabled,
                carryOverOverdue = d.carryOverOverdue,
                blockDuringFocus = d.blockDuringFocus,
                bypassDurationMinutes = d.bypassDurationMinutes,
                maxBypassesPerDay = d.maxBypassesPerDay,
                bypassCooldownMinutes = d.bypassCooldownMinutes,
                recoveryUntil = d.recoveryUntilEpochMillis?.let(Instant::ofEpochMilli),
                userExemptPackages = d.userExemptPackages.toSet(),
            )
        } catch (e: Exception) {
            BlockerConfig()
        }
    }

    // ---------- FocusConfig ----------

    @Serializable
    internal data class FocusConfigDto(
        val workMinutes: Int = 25,
        val shortBreakMinutes: Int = 5,
        val longBreakMinutes: Int = 15,
        val sessionsBeforeLongBreak: Int = 4,
        val autoStartBreaks: Boolean = true,
        val autoStartWork: Boolean = false,
    )

    fun encodeFocusConfig(c: FocusConfig): String = json.encodeToString(
        FocusConfigDto.serializer(),
        FocusConfigDto(
            c.workMinutes, c.shortBreakMinutes, c.longBreakMinutes,
            c.sessionsBeforeLongBreak, c.autoStartBreaks, c.autoStartWork,
        ),
    )

    fun decodeFocusConfig(value: String?): FocusConfig {
        if (value.isNullOrBlank()) return FocusConfig()
        return try {
            val d = json.decodeFromString(FocusConfigDto.serializer(), value)
            FocusConfig(
                workMinutes = d.workMinutes,
                shortBreakMinutes = d.shortBreakMinutes,
                longBreakMinutes = d.longBreakMinutes,
                sessionsBeforeLongBreak = d.sessionsBeforeLongBreak,
                autoStartBreaks = d.autoStartBreaks,
                autoStartWork = d.autoStartWork,
            )
        } catch (e: Exception) {
            FocusConfig()
        }
    }

    // ---------- FocusState (running timer) ----------

    @Serializable
    internal data class FocusStateDto(
        val phase: String = FocusPhase.IDLE.name,
        val paused: Boolean = false,
        val phaseStartedAtMillis: Long? = null,
        val phaseEndsAtMillis: Long? = null,
        val pausedRemainingMillis: Long? = null,
        val completedWorkSessions: Int = 0,
        val taskId: Long? = null,
        val currentSessionId: Long? = null,
        val interruptions: Int = 0,
    )

    fun encodeFocusState(s: FocusState): String = json.encodeToString(
        FocusStateDto.serializer(),
        FocusStateDto(
            phase = s.phase.name,
            paused = s.paused,
            phaseStartedAtMillis = s.phaseStartedAt?.toEpochMilli(),
            phaseEndsAtMillis = s.phaseEndsAt?.toEpochMilli(),
            pausedRemainingMillis = s.pausedRemainingMillis,
            completedWorkSessions = s.completedWorkSessions,
            taskId = s.taskId,
            currentSessionId = s.currentSessionId,
            interruptions = s.interruptions,
        ),
    )

    /** Null for absent or unreadable state (the timer then simply starts IDLE). */
    fun decodeFocusState(value: String?): FocusState? {
        if (value.isNullOrBlank()) return null
        return try {
            val d = json.decodeFromString(FocusStateDto.serializer(), value)
            FocusState(
                phase = enumOr(d.phase, FocusPhase.IDLE),
                paused = d.paused,
                phaseStartedAt = d.phaseStartedAtMillis?.let(Instant::ofEpochMilli),
                phaseEndsAt = d.phaseEndsAtMillis?.let(Instant::ofEpochMilli),
                pausedRemainingMillis = d.pausedRemainingMillis,
                completedWorkSessions = d.completedWorkSessions,
                taskId = d.taskId,
                currentSessionId = d.currentSessionId,
                interruptions = d.interruptions,
            )
        } catch (e: Exception) {
            null
        }
    }
}
