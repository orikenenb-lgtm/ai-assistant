package com.disciplineos.app.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackendUrlValidatorTest {

    private val debugHosts = setOf(AiBackendConfig.EMULATOR_HOST)

    @Test
    fun httpsIsAcceptedAndPathAppended() {
        assertEquals(
            "https://abc.supabase.co/functions/v1/coach-stream/v1/coach/stream",
            BackendUrlValidator.streamEndpoint("https://abc.supabase.co/functions/v1/coach-stream").toString(),
        )
        assertEquals(
            "https://api.example.com/v1/coach/stream",
            BackendUrlValidator.streamEndpoint("https://api.example.com/").toString(),
        )
        assertEquals(
            "https://api.example.com/v1/coach/stream",
            BackendUrlValidator.streamEndpoint("  https://api.example.com  ").toString(),
        )
    }

    @Test
    fun cleartextIsRejectedInRelease() {
        assertNull(BackendUrlValidator.streamEndpoint("http://api.example.com"))
        assertNull(BackendUrlValidator.streamEndpoint("http://10.0.2.2:54321/functions/v1/coach-stream"))
    }

    @Test
    fun emulatorCleartextOnlyWhenDebugAllowsIt() {
        assertEquals(
            "http://10.0.2.2:54321/functions/v1/coach-stream/v1/coach/stream",
            BackendUrlValidator.streamEndpoint("http://10.0.2.2:54321/functions/v1/coach-stream", debugHosts).toString(),
        )
        assertNull(BackendUrlValidator.streamEndpoint("http://192.168.1.10", debugHosts))
        assertNull(BackendUrlValidator.streamEndpoint("http://localhost", debugHosts))
    }

    @Test
    fun malformedOrDangerousUrlsAreRejected() {
        assertNull(BackendUrlValidator.streamEndpoint(""))
        assertNull(BackendUrlValidator.streamEndpoint("   "))
        assertNull(BackendUrlValidator.streamEndpoint("not a url"))
        assertNull(BackendUrlValidator.streamEndpoint("ftp://api.example.com"))
        assertNull(BackendUrlValidator.streamEndpoint("file:///etc/passwd"))
        assertNull(BackendUrlValidator.streamEndpoint("https://user:pass@api.example.com"))
        assertNull(BackendUrlValidator.streamEndpoint("https://api.example.com?key=abc"))
        assertNull(BackendUrlValidator.streamEndpoint("https://api.example.com#frag"))
    }

    @Test
    fun configReportsConfiguredOnlyWhenNonBlank() {
        assertFalse(AiBackendConfig("").isConfigured)
        assertFalse(AiBackendConfig("  ").isConfigured)
        assertTrue(AiBackendConfig("https://api.example.com").isConfigured)
        assertNull(AiBackendConfig("http://api.example.com").streamEndpoint())
    }
}
