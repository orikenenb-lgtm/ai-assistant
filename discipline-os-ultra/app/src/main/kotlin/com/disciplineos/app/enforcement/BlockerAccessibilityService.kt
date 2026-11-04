package com.disciplineos.app.enforcement

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import com.disciplineos.core.model.BlockDecision
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * OPTIONAL detection mode. Accessed data: ONLY the package name of TYPE_WINDOW_STATE_CHANGED events.
 * - canRetrieveWindowContent=false: no screen content is ever read (we never touch event.source or windows).
 * - No gestures, no global actions, no input is performed.
 * - Nothing is stored or sent off-device; the package name is evaluated in memory and dropped.
 *
 * The service stays inert unless the user accepted the in-app disclosure and selected this mode.
 * If the user switches back to the default mode or withdraws consent, it disables itself.
 */
@AndroidEntryPoint
class BlockerAccessibilityService : AccessibilityService() {

    @Inject lateinit var engine: EnforcementEngine
    @Inject lateinit var launcher: BlockScreenLauncher
    @Inject lateinit var prefs: EnforcementPrefs
    @Inject lateinit var controller: EnforcementController

    private var scope: CoroutineScope? = null
    @Volatile private var active = false

    override fun onServiceConnected() {
        super.onServiceConnected()
        val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        scope = serviceScope
        serviceScope.launch {
            combine(prefs.mode, prefs.accessibilityConsentAt) { mode, consent -> mode to consent }
                .collect { (mode, consent) ->
                    val wasActive = active
                    active = consent != null && mode == EnforcementMode.ACCESSIBILITY
                    engine.setAccessibilityConnected(active)
                    if (wasActive && !active) {
                        // User returned to the default mode / withdrew consent: turn ourselves off.
                        disableSelf()
                    }
                }
        }
        // Keep the policy input hot while connected so evaluate() has fresh data.
        serviceScope.launch { engine.input.collect { } }
        controller.sync()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (!active || event == null) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg == packageName) return
        if (engine.evaluate(pkg) is BlockDecision.Block) {
            launcher.launch(pkg, fromAccessibility = true)
        }
    }

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        teardown()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        teardown()
        super.onDestroy()
    }

    private fun teardown() {
        active = false
        if (::engine.isInitialized) engine.setAccessibilityConnected(false)
        scope?.cancel()
        scope = null
    }
}
