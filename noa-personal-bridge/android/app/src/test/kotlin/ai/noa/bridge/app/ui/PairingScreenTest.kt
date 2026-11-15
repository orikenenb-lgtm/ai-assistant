package ai.noa.bridge.app.ui

import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.PairingResult
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.pairing.PairingScreen
import ai.noa.bridge.app.ui.pairing.PairingValidation
import ai.noa.bridge.app.ui.preview.FakeAppController
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PairingScreenTest {
    @get:Rule val rule = createComposeRule()

    private fun setPairing(fake: FakeAppController) {
        rule.setContent {
            TestFrame {
                val status by fake.status.collectAsState()
                PairingScreen(fake, status, onBack = {})
            }
        }
    }

    @Test
    fun invalidInput_showsErrors_andDoesNotPair() {
        val fake = FakeAppController(initialStatus = BridgeStatus())
        setPairing(fake)
        rule.onNodeWithTag("pairingUrl").performTextReplacement("http://insecure.example.com")
        rule.onNodeWithTag("pairingCode").performTextReplacement("AB12")
        rule.onNodeWithTag("pairingSubmit").performScrollTo().performClick()
        rule.waitForIdle()
        assertTrue(fake.pairCalls.isEmpty())
        rule.onNodeWithText(str(R.string.pairing_url_error)).assertExists()
        rule.onNodeWithText(str(R.string.pairing_code_error)).assertExists()
    }

    @Test
    fun validInput_pairs_andShowsSuccess() {
        val fake = FakeAppController(initialStatus = BridgeStatus())
        setPairing(fake)
        rule.onNodeWithTag("pairingUrl").performTextReplacement("https://bridge.example.com/")
        rule.onNodeWithTag("pairingCode").performTextReplacement("ab-12 cd34")
        rule.onNodeWithTag("pairingSubmit").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf("https://bridge.example.com" to "ab12cd34"), fake.pairCalls)
        rule.onNodeWithTag("pairingSuccess").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun failure_showsServerMessage() {
        val fake = FakeAppController(initialStatus = BridgeStatus(), pairingResult = PairingResult.Failure("הקוד פג תוקף"))
        setPairing(fake)
        rule.onNodeWithTag("pairingUrl").performTextReplacement("https://bridge.example.com")
        rule.onNodeWithTag("pairingCode").performTextReplacement("ABCD1234")
        rule.onNodeWithTag("pairingSubmit").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText(str(R.string.pairing_failure, "הקוד פג תוקף")).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun validation_rules() {
        assertTrue(PairingValidation.isValidBaseUrl("https://bridge.example.com"))
        assertTrue(PairingValidation.isValidBaseUrl(" https://bridge.example.com:8443/api/ "))
        assertFalse(PairingValidation.isValidBaseUrl("http://bridge.example.com"))
        assertFalse(PairingValidation.isValidBaseUrl("https://"))
        assertFalse(PairingValidation.isValidBaseUrl("https://user:pw@bridge.example.com"))
        assertFalse(PairingValidation.isValidBaseUrl("https://bad host.com"))
        assertEquals("ABCD1234", PairingValidation.sanitizeCode("AB-CD 12345"))
        assertTrue(PairingValidation.isValidCode("abCD1234"))
        assertFalse(PairingValidation.isValidCode("ABC123"))
        assertFalse(PairingValidation.isValidCode("ABCD12א4"))
    }
}
