package com.disciplineos.app.enforcement

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.provider.Telephony
import android.telecom.TelecomManager
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Packages that must never be covered by the block screen on THIS device, resolved at runtime:
 * default dialer + every app handling ACTION_DIAL, default SMS app, every HOME launcher, current keyboard,
 * plus a fixed safety list (Settings, SystemUI, permission controller, installers, emergency / SOS apps,
 * cell broadcast alerts, Samsung Device Care so battery settings stay reachable).
 *
 * The domain's ProtectedPackages.ALWAYS is applied on top of this inside the policy engine.
 */
@Singleton
class DeviceProtectedPackages @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    @Volatile private var cached: Set<String> = emptySet()
    @Volatile private var cachedAt: Long = 0L

    /** Cached for [TTL_MS]; cheap to call. Safe from any thread. */
    fun get(): Set<String> {
        val now = SystemClock.elapsedRealtime()
        if (cached.isEmpty() || now - cachedAt > TTL_MS) {
            cached = resolve()
            cachedAt = now
        }
        return cached
    }

    fun contains(packageName: String): Boolean = packageName in SAFETY_LIST || packageName in get()

    private fun resolve(): Set<String> {
        val result = HashSet<String>(SAFETY_LIST)
        result += context.packageName
        runCatching {
            val telecom = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
            telecom?.defaultDialerPackage?.let(result::add)
        }
        runCatching { Telephony.Sms.getDefaultSmsPackage(context)?.let(result::add) }
        runCatching { result += queryPackages(Intent(Intent.ACTION_DIAL)) }
        runCatching { result += queryPackages(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)) }
        runCatching {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
                ?.let(ComponentName::unflattenFromString)
                ?.packageName
                ?.let(result::add)
        }
        return result
    }

    private fun queryPackages(intent: Intent): Set<String> {
        val pm = context.packageManager
        val infos: List<ResolveInfo> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(intent, 0)
        }
        return infos.mapNotNullTo(HashSet()) { it.activityInfo?.packageName }
    }

    companion object {
        private const val TTL_MS = 5 * 60_000L

        /** Never blockable on any device. Intentionally generous: a false "protected" only weakens the blocker. */
        val SAFETY_LIST: Set<String> = setOf(
            // System UI, settings and permission flows (the user must always be able to change or revoke anything)
            "android",
            "com.android.systemui",
            "com.android.settings",
            "com.android.settings.intelligence",
            "com.google.android.permissioncontroller",
            "com.android.permissioncontroller",
            "com.google.android.packageinstaller",
            "com.android.packageinstaller",
            "com.samsung.android.settings",
            "com.samsung.accessibility",
            "com.google.android.marvin.talkback",
            "com.samsung.android.lool", // Device Care (battery settings)
            "com.samsung.android.sm",
            "com.samsung.android.sm.devicesecurity",
            // Telephony, emergency and alerts
            "com.android.phone",
            "com.android.server.telecom",
            "com.android.dialer",
            "com.google.android.dialer",
            "com.samsung.android.dialer",
            "com.samsung.android.incallui",
            "com.samsung.android.app.telephonyui",
            "com.android.emergency",
            "com.google.android.apps.safetyhub",
            "com.samsung.android.emergency",
            "com.sec.android.app.safetyassurance",
            "com.android.cellbroadcastreceiver",
            "com.google.android.cellbroadcastreceiver",
            "com.android.cellbroadcastreceiver.module",
            "com.android.stk",
            // Messaging
            "com.android.mms",
            "com.google.android.apps.messaging",
            "com.samsung.android.messaging",
            // Launchers (also resolved dynamically)
            "com.sec.android.app.launcher",
            "com.google.android.apps.nexuslauncher",
            "com.android.launcher3",
        )
    }
}
