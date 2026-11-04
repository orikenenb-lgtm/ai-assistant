package com.disciplineos.app.enforcement

import android.app.Notification
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.disciplineos.app.enforcement.ui.PermissionChecks
import com.disciplineos.app.notifications.NotificationChannels
import com.disciplineos.core.domain.blocker.BlockPolicyInput
import com.disciplineos.core.model.BlockDecision
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * User-enabled foreground service (type specialUse) that keeps the blocker working while the app is in the background.
 *
 * Battery strategy:
 *  - No polling while the screen is off (ACTION_SCREEN_OFF/ON receiver).
 *  - No polling when nothing could be blocked (blocker off, recovery mode, no targets, no open mandatory and no focus).
 *  - No polling while the consented accessibility detector is connected (event-driven instead).
 *  - 1s polling only while a restriction is active; 5s while one is merely possible (e.g. during a bypass).
 *  - The policy input itself is a cold DB flow + 15s ticker that only runs while this service collects it.
 *
 * Transparency: the notification is always shown, low importance, and states the current state in plain Hebrew.
 */
@AndroidEntryPoint
class EnforcementService : LifecycleService() {

    @Inject lateinit var engine: EnforcementEngine
    @Inject lateinit var detector: ForegroundAppDetector
    @Inject lateinit var launcher: BlockScreenLauncher
    @Inject lateinit var notifier: EnforcementNotifier

    private var screenInteractive = true
    private var pollJob: Job? = null
    private var pollInterval: Long? = null
    private var lastStatus: EnforcementStatus? = null
    private var latestInput: BlockPolicyInput? = null
    private var latestRestriction: BlockDecision? = null
    private var accessibilityActive = false
    private var receiverRegistered = false

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    screenInteractive = false
                    detector.reset()
                }
                Intent.ACTION_SCREEN_ON, Intent.ACTION_USER_PRESENT -> screenInteractive = true
            }
            updatePolling(forceImmediateTick = screenInteractive)
        }
    }

    override fun onCreate() {
        super.onCreate()
        // Must be in the foreground within a few seconds of startForegroundService().
        goForeground(notifier.buildOngoing(EnforcementStatus.Starting))
        lastStatus = EnforcementStatus.Starting
        notifier.cancelStartPrompt()

        screenInteractive = (getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive ?: true
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        ContextCompat.registerReceiver(this, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiverRegistered = true

        lifecycleScope.launch {
            combine(engine.input, engine.health, engine.accessibilityConnected) { input, health, a11y ->
                Triple(input, health, a11y)
            }.collect { (input, health, a11y) -> onState(input, health, a11y) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        // Re-assert foreground state for every start request (required after startForegroundService()).
        goForeground(notifier.buildOngoing(lastStatus ?: EnforcementStatus.Starting))
        return START_STICKY
    }

    override fun onDestroy() {
        pollJob?.cancel()
        if (receiverRegistered) {
            runCatching { unregisterReceiver(screenReceiver) }
            receiverRegistered = false
        }
        engine.reportHealth { EnforcementHealth() }
        super.onDestroy()
    }

    private fun goForeground(notification: Notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceCompat.startForeground(
                    this, NotificationChannels.ID_ENFORCEMENT, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
                )
            } else {
                startForeground(NotificationChannels.ID_ENFORCEMENT, notification)
            }
        } catch (_: IllegalStateException) {
            // e.g. a sticky restart from the background that Android 12+ refuses. Never run invisibly:
            // ask the user to open the app (which re-syncs) and stop.
            notifier.postStartPrompt()
            stopSelf()
        } catch (_: SecurityException) {
            notifier.postStartPrompt()
            stopSelf()
        }
    }

    private fun onState(input: BlockPolicyInput?, health: EnforcementHealth, a11y: Boolean) {
        latestInput = input
        accessibilityActive = a11y
        if (input != null && !input.config.enabled) {
            stopSelfCleanly()
            return
        }
        latestRestriction = input?.let(engine::currentRestriction)

        // Usage access can be revoked at any time from Settings: surface it instead of failing silently.
        val usageMissing = !a11y && !detector.hasPermission()
        val overlayMissing = !a11y && !PermissionChecks.canLaunchBlockScreen(this)
        if (usageMissing != health.usageAccessMissing || overlayMissing != health.overlayMissing) {
            engine.reportHealth { EnforcementHealth(usageAccessMissing = usageMissing, overlayMissing = overlayMissing) }
            return // the health flow re-emits and we come back here
        }
        refreshNotification(health)
        updatePolling(forceImmediateTick = false)
    }

    private fun refreshNotification(health: EnforcementHealth = engine.health.value) {
        val status = enforcementStatusOf(latestRestriction, latestInput, health)
        if (status != lastStatus) {
            lastStatus = status
            notifier.updateOngoing(status)
        }
    }

    private fun currentConditions(): PollingConditions {
        val input = latestInput
        return PollingConditions(
            blockerEnabled = input?.config?.enabled == true,
            screenInteractive = screenInteractive,
            restrictionPossible = input != null && isRestrictionPossible(input),
            restrictionActive = latestRestriction is BlockDecision.Block,
            accessibilityDetectionActive = accessibilityActive,
        )
    }

    private fun updatePolling(forceImmediateTick: Boolean) {
        val interval = PollingPolicy.intervalMillis(currentConditions())
        if (interval == pollInterval && pollJob?.isActive == true && !forceImmediateTick) return
        if (interval == null && pollJob == null) {
            pollInterval = null
            return
        }
        pollJob?.cancel()
        pollJob = null
        pollInterval = interval
        if (interval == null) return
        pollJob = lifecycleScope.launch {
            while (isActive) {
                tick()
                delay(pollInterval ?: break)
            }
        }
    }

    private suspend fun tick() {
        val pkg = withContext(Dispatchers.Default) { detector.currentForegroundPackage() }
        if (pkg == null) {
            if (!detector.hasPermission() && !engine.health.value.usageAccessMissing) {
                engine.reportHealth { it.copy(usageAccessMissing = true) }
            }
            return
        }
        val decision = engine.evaluate(pkg)
        if (decision is BlockDecision.Block) {
            withContext(Dispatchers.Default) { launcher.launch(pkg) }
            refreshNotification()
        }
    }

    private fun stopSelfCleanly() {
        pollJob?.cancel()
        pollJob = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    companion object {
        fun intent(context: Context): Intent = Intent(context, EnforcementService::class.java)
    }
}
