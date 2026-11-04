package com.disciplineos.app.ui.coach

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CoachInputTest {

    @Test fun clampCapsAtMax() {
        assertEquals(CoachInput.MAX_CHARS, CoachInput.clamp("x".repeat(5_000)).length)
        assertEquals("שלום", CoachInput.clamp("שלום"))
    }

    @Test fun canSendRules() {
        assertTrue(CoachInput.canSend("היי", sending = false, limitReached = false))
        assertFalse(CoachInput.canSend("   ", sending = false, limitReached = false))
        assertFalse(CoachInput.canSend("היי", sending = true, limitReached = false))
        assertFalse(CoachInput.canSend("היי", sending = false, limitReached = true))
        assertFalse(CoachInput.canSend("x".repeat(CoachInput.MAX_CHARS + 1), sending = false, limitReached = false))
    }

    @Test fun counterShownNearLimit() {
        assertFalse(CoachInput.showCounter(100))
        assertTrue(CoachInput.showCounter(1_600))
    }

    @Test fun remoteNeedsOptInAndBackend() {
        assertFalse(CoachInput.usesRemote(remoteEnabled = false, backendConfigured = true))
        assertFalse(CoachInput.usesRemote(remoteEnabled = true, backendConfigured = false))
        assertTrue(CoachInput.usesRemote(remoteEnabled = true, backendConfigured = true))
    }
}
