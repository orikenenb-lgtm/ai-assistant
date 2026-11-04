package com.disciplineos.app.enforcement.ui

import android.Manifest
import android.app.AlarmManager
import android.app.AppOpsManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import android.text.TextUtils
import androidx.core.content.ContextCompat
import com.disciplineos.app.enforcement.BlockerAccessibilityService

/** Every permission / special access the blocker cares about. */
enum class PermissionKind {
    USAGE_ACCESS,
    OVERLAY,
    NOTIFICATIONS,
    BATTERY_OPTIMIZATION,
    ACCESSIBILITY,
    EXACT_ALARM,
}

data class PermissionItem(
    val kind: PermissionKind,
    val granted: Boolean,
    /** Needed for the default (UsageStats + overlay) enforcement mode to work. */
    val required: Boolean,
    /** False when the permission does not exist / is not used on this Android version. */
    val applicable: Boolean = true,
)

data class PermissionSnapshot(
    val usageAccess: Boolean,
    val overlay: Boolean,
    val notifications: Boolean,
    val batteryUnrestricted: Boolean,
    val accessibilityEnabled: Boolean,
    val exactAlarms: Boolean,
) {
    /** The default enforcement mode needs usage access, and the overlay grant to start the block screen on Android 10+. */
    val usageModeReady: Boolean get() = usageAccess && (overlay || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)

    fun items(): List<PermissionItem> = listOf(
        PermissionItem(PermissionKind.USAGE_ACCESS, usageAccess, required = true),
        PermissionItem(PermissionKind.OVERLAY, overlay, required = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q),
        PermissionItem(
            PermissionKind.NOTIFICATIONS, notifications, required = false,
            applicable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU,
        ),
        PermissionItem(PermissionKind.BATTERY_OPTIMIZATION, batteryUnrestricted, required = false),
        PermissionItem(PermissionKind.ACCESSIBILITY, accessibilityEnabled, required = false),
        PermissionItem(
            PermissionKind.EXACT_ALARM, exactAlarms, required = false,
            // The manifest declares SCHEDULE_EXACT_ALARM with maxSdkVersion=32; on 33+ the focus timer uses inexact alarms.
            applicable = Build.VERSION.SDK_INT in Build.VERSION_CODES.S..Build.VERSION_CODES.S_V2,
        ),
    )
}

/** Read-only permission checks. None of these request anything or use restricted APIs. */
object PermissionChecks {

    fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        }
        return if (mode == AppOpsManager.MODE_DEFAULT) {
            context.checkCallingOrSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED
        } else {
            mode == AppOpsManager.MODE_ALLOWED
        }
    }

    fun canDrawOverlays(context: Context): Boolean = Settings.canDrawOverlays(context)

    /** Android 10+ needs the overlay grant to start the block screen from the background. */
    fun canLaunchBlockScreen(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || canDrawOverlays(context)

    fun notificationsGranted(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else {
            androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()
        }

    fun ignoringBatteryOptimizations(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    fun accessibilityServiceEnabled(context: Context): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val ours = ComponentName(context, BlockerAccessibilityService::class.java)
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        while (splitter.hasNext()) {
            val component = ComponentName.unflattenFromString(splitter.next())
            if (component != null && component == ours) return true
        }
        return false
    }

    fun canScheduleExactAlarms(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return false
        return am.canScheduleExactAlarms()
    }

    fun snapshot(context: Context): PermissionSnapshot = PermissionSnapshot(
        usageAccess = hasUsageAccess(context),
        overlay = canDrawOverlays(context),
        notifications = notificationsGranted(context),
        batteryUnrestricted = ignoringBatteryOptimizations(context),
        accessibilityEnabled = accessibilityServiceEnabled(context),
        exactAlarms = canScheduleExactAlarms(context),
    )
}

/** Intents to the exact system settings screen for each item, with safe fallbacks. */
object PermissionIntents {

    private fun packageUri(context: Context): Uri = Uri.fromParts("package", context.packageName, null)

    fun appDetails(context: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri(context))

    fun forKind(context: Context, kind: PermissionKind): Intent = when (kind) {
        PermissionKind.USAGE_ACCESS -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        PermissionKind.OVERLAY -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, packageUri(context))
        PermissionKind.NOTIFICATIONS -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        // The list screen. We deliberately do NOT use ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
        // (needs a restricted permission and is policy-sensitive on Google Play).
        PermissionKind.BATTERY_OPTIMIZATION -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        PermissionKind.ACCESSIBILITY -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        PermissionKind.EXACT_ALARM -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, packageUri(context))
        } else {
            appDetails(context)
        }
    }

    /** Starts [intent]; falls back to the app details page, then to the main Settings screen. Never throws. */
    fun open(context: Context, intent: Intent): Boolean {
        val candidates = listOf(intent, appDetails(context), Intent(Settings.ACTION_SETTINGS))
        for (candidate in candidates) {
            try {
                if (context !is android.app.Activity) candidate.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(candidate)
                return true
            } catch (_: ActivityNotFoundException) {
                // try next
            } catch (_: SecurityException) {
                // try next
            }
        }
        return false
    }

    fun open(context: Context, kind: PermissionKind): Boolean = open(context, forKind(context, kind))
}
