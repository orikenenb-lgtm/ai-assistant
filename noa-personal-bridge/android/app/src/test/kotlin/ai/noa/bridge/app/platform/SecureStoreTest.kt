package ai.noa.bridge.app.platform

import ai.noa.bridge.app.ExclusionEntry
import ai.noa.bridge.core.BridgeSettings
import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SecureStoreTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val cipher = FakeCipher()
    private val store = SecureStore(context, cipher)

    private fun rawPrefs(): String =
        context.getSharedPreferences(SecureStore.PREFS_NAME, Context.MODE_PRIVATE).all.values.joinToString("|")

    @Test
    fun roundTripsTokenUrlAndExclusionsEncrypted() {
        store.deviceToken = "device-token-123"
        store.baseUrl = "https://bridge.example.com/"
        store.deviceId = "dev_1"
        store.setExclusions(listOf(ExclusionEntry("a".repeat(64), "דנה כהן")))

        assertEquals("device-token-123", store.deviceToken)
        assertEquals("https://bridge.example.com/", store.baseUrl)
        assertEquals("dev_1", store.deviceId)
        assertEquals(listOf(ExclusionEntry("a".repeat(64), "דנה כהן")), store.exclusions())

        val raw = rawPrefs()
        assertFalse(raw.contains("device-token-123"))
        assertFalse(raw.contains("bridge.example.com"))
        assertFalse(raw.contains("דנה"))
        assertTrue(raw.contains("fake:"))
    }

    @Test
    fun clearCredentialsKeepsUrlAndExclusions() {
        store.deviceToken = "t"
        store.deviceId = "d"
        store.baseUrl = "https://x/"
        store.setExclusions(listOf(ExclusionEntry("b".repeat(64), "יוסי")))
        store.clearCredentials()
        assertNull(store.deviceToken)
        assertNull(store.deviceId)
        assertEquals("https://x/", store.baseUrl)
        assertEquals(1, store.exclusions().size)
    }

    @Test
    fun wipeAllDeletesEverythingAndDestroysKey() {
        store.deviceToken = "t"
        store.setExclusions(listOf(ExclusionEntry("b".repeat(64), "יוסי")))
        store.wipeAll()
        assertTrue(cipher.destroyed)
        assertNull(store.deviceToken)
        assertTrue(store.exclusions().isEmpty())
        assertTrue(context.getSharedPreferences(SecureStore.PREFS_NAME, Context.MODE_PRIVATE).all.isEmpty())
    }

    @Test
    fun undecryptableValueReadsAsNull() {
        context.getSharedPreferences(SecureStore.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString("device_token", "garbage").commit()
        assertNull(store.deviceToken)
    }

    @Test
    fun settingsStoreRoundTripAndWipe() {
        val settingsStore = SettingsStore(context)
        assertEquals(BridgeSettings(debounceMillis = 15_000L), settingsStore.load(emptySet(), 15_000L))
        settingsStore.save(BridgeSettings(paused = true, emergencyStopped = true, cloudConsentGiven = true, sendingEnabled = true))
        val loaded = settingsStore.load(setOf(key('a')), 15_000L)
        assertTrue(loaded.paused && loaded.emergencyStopped && loaded.cloudConsentGiven && loaded.sendingEnabled)
        assertEquals(setOf(key('a')), loaded.excludedConversations)
        settingsStore.wipeAll()
        assertFalse(settingsStore.load(emptySet(), 15_000L).paused)
    }
}
