package ai.noa.bridge.app.ui.onboarding

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * UI-only first-run flags. Holds no message content and nothing the core needs; the consent itself
 * lives in BridgeSettings via AppController.setCloudConsent.
 */
interface OnboardingStore {
    /** The user reached the end of onboarding and made a consent decision (agree or skip). */
    val onboardingDone: Boolean
    fun markOnboardingDone()
    /** The one-time POST_NOTIFICATIONS rationale was already shown. */
    val postNotificationsAsked: Boolean
    fun markPostNotificationsAsked()
}

class InMemoryOnboardingStore(done: Boolean = false, asked: Boolean = false) : OnboardingStore {
    override var onboardingDone by mutableStateOf(done); private set
    override var postNotificationsAsked by mutableStateOf(asked); private set
    override fun markOnboardingDone() { onboardingDone = true }
    override fun markPostNotificationsAsked() { postNotificationsAsked = true }
}

class SharedPrefsOnboardingStore(context: Context) : OnboardingStore {
    private val prefs = context.applicationContext.getSharedPreferences("noa_ui_onboarding", Context.MODE_PRIVATE)

    override var onboardingDone by mutableStateOf(prefs.getBoolean(KEY_DONE, false)); private set
    override var postNotificationsAsked by mutableStateOf(prefs.getBoolean(KEY_ASKED, false)); private set

    override fun markOnboardingDone() {
        prefs.edit().putBoolean(KEY_DONE, true).apply()
        onboardingDone = true
    }

    override fun markPostNotificationsAsked() {
        prefs.edit().putBoolean(KEY_ASKED, true).apply()
        postNotificationsAsked = true
    }

    private companion object {
        const val KEY_DONE = "onboarding_done"
        const val KEY_ASKED = "post_notifications_asked"
    }
}
