package com.disciplineos.app.enforcement.ui

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.os.Build
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.graphics.drawable.toBitmap
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.text.Collator
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

data class InstalledApp(
    val packageName: String,
    val label: String,
    val icon: ImageBitmap?,
)

/**
 * Lists launchable apps only (MAIN/LAUNCHER, matching the manifest <queries>); no QUERY_ALL_PACKAGES.
 * Icons are rasterised off the main thread and cached in memory for the process lifetime.
 * The list never leaves the device and is never logged.
 */
@Singleton
class InstalledAppsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val mutex = Mutex()
    private var cache: List<InstalledApp>? = null

    suspend fun launchableApps(forceRefresh: Boolean = false): List<InstalledApp> = mutex.withLock {
        cache?.takeUnless { forceRefresh }?.let { return@withLock it }
        val loaded = withContext(Dispatchers.IO) { load() }
        cache = loaded
        loaded
    }

    private fun load(): List<InstalledApp> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val infos: List<ResolveInfo> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(intent, 0)
        }
        val iconPx = (48 * context.resources.displayMetrics.density).toInt().coerceIn(48, 192)
        val collator = Collator.getInstance(Locale.getDefault())
        return infos
            .asSequence()
            .filter { it.activityInfo != null && it.activityInfo.packageName != context.packageName }
            .distinctBy { it.activityInfo.packageName }
            .map { info ->
                val label = runCatching { info.loadLabel(pm).toString() }.getOrDefault(info.activityInfo.packageName)
                val icon = runCatching {
                    info.loadIcon(pm).toBitmap(iconPx, iconPx).asImageBitmap()
                }.getOrNull()
                InstalledApp(info.activityInfo.packageName, label, icon)
            }
            .toList()
            .sortedWith { a, b -> collator.compare(a.label, b.label) }
    }
}
