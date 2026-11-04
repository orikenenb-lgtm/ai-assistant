package com.disciplineos.app.data

import com.disciplineos.app.data.prefs.PrefsCodec
import com.disciplineos.core.model.BlockerConfig
import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.FocusPhase
import com.disciplineos.core.model.FocusState
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PrefsCodecTest {

    @Test
    fun blockerConfig_roundTrips() {
        val c = BlockerConfig(
            enabled = true, carryOverOverdue = false, blockDuringFocus = false, bypassDurationMinutes = 5,
            maxBypassesPerDay = 1, bypassCooldownMinutes = 60, recoveryUntil = Instant.parse("2026-11-05T10:00:00Z"),
            userExemptPackages = setOf("com.bank.app", "org.health"),
        )
        assertEquals(c, PrefsCodec.decodeBlockerConfig(PrefsCodec.encodeBlockerConfig(c)))
    }

    @Test
    fun blockerConfig_missingOrCorrupt_givesDefaults() {
        assertEquals(BlockerConfig(), PrefsCodec.decodeBlockerConfig(null))
        assertEquals(BlockerConfig(), PrefsCodec.decodeBlockerConfig("{{{"))
        // Unknown keys are ignored, missing keys take defaults.
        assertEquals(BlockerConfig(enabled = true), PrefsCodec.decodeBlockerConfig("""{"enabled":true,"newField":1}"""))
    }

    @Test
    fun focusConfig_roundTrips() {
        val c = FocusConfig(50, 10, 20, 3, autoStartBreaks = false, autoStartWork = true)
        assertEquals(c, PrefsCodec.decodeFocusConfig(PrefsCodec.encodeFocusConfig(c)))
        assertEquals(FocusConfig(), PrefsCodec.decodeFocusConfig("garbage"))
    }

    @Test
    fun focusState_roundTrips_andCorruptIsNull() {
        val s = FocusState(
            phase = FocusPhase.WORK, paused = true, phaseStartedAt = Instant.ofEpochMilli(1_000),
            phaseEndsAt = Instant.ofEpochMilli(1_500_000), pausedRemainingMillis = 42_000, completedWorkSessions = 2,
            taskId = 9, currentSessionId = 4, interruptions = 1,
        )
        assertEquals(s, PrefsCodec.decodeFocusState(PrefsCodec.encodeFocusState(s)))
        assertEquals(FocusState(), PrefsCodec.decodeFocusState(PrefsCodec.encodeFocusState(FocusState())))
        assertNull(PrefsCodec.decodeFocusState(null))
        assertNull(PrefsCodec.decodeFocusState("not-json"))
        assertEquals(FocusPhase.IDLE, PrefsCodec.decodeFocusState("""{"phase":"MARS"}""")!!.phase)
    }

    @Test
    fun focusState_phasePlannedMillis_roundTrips() {
        val s = FocusState(
            phase = FocusPhase.WORK, paused = true, phaseStartedAt = Instant.ofEpochMilli(1_000),
            pausedRemainingMillis = 42_000, phasePlannedMillis = 25 * 60_000L,
        )
        val decoded = PrefsCodec.decodeFocusState(PrefsCodec.encodeFocusState(s))
        assertEquals(s, decoded)
        assertEquals(25 * 60_000L, decoded!!.phasePlannedMillis)
    }

    @Test
    fun focusState_legacyJsonWithoutPlannedLength_decodesWithNull() {
        // JSON persisted by a version that predates phasePlannedMillis.
        val legacy = """{"phase":"WORK","paused":true,"phaseStartedAtMillis":1000,"pausedRemainingMillis":42000,""" +
            """"completedWorkSessions":2,"taskId":9,"currentSessionId":4,"interruptions":1}"""
        val decoded = PrefsCodec.decodeFocusState(legacy)!!
        assertEquals(FocusPhase.WORK, decoded.phase)
        assertEquals(42_000L, decoded.pausedRemainingMillis)
        assertNull(decoded.phasePlannedMillis)
    }
}
