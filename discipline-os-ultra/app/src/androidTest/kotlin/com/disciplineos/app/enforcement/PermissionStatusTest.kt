package com.disciplineos.app.enforcement

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.disciplineos.app.enforcement.ui.PermissionChecks
import com.disciplineos.app.enforcement.ui.PermissionIntents
import com.disciplineos.app.enforcement.ui.PermissionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Skeleton device test for the permission checklist. On a fresh test install, special accesses are not granted,
 * so the checks must report "missing" without throwing; every settings intent must resolve to some screen.
 */
@RunWith(AndroidJUnit4::class)
class PermissionStatusTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun snapshotDoesNotThrowAndListsAllKinds() {
        val snapshot = PermissionChecks.snapshot(context)
        assertEquals(PermissionKind.entries.size, snapshot.items().size)
    }

    @Test
    fun freshInstallHasNoUsageAccessOrAccessibility() {
        // Usage access and accessibility can only be granted manually by the user in Settings.
        assertFalse(PermissionChecks.hasUsageAccess(context))
        assertFalse(PermissionChecks.accessibilityServiceEnabled(context))
        assertFalse(PermissionChecks.snapshot(context).usageModeReady)
    }

    @Test
    fun settingsIntentsResolve() {
        val pm = context.packageManager
        PermissionKind.entries.forEach { kind ->
            val intent = PermissionIntents.forKind(context, kind)
            assertNotNull(intent.action)
            val resolves = pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null ||
                pm.resolveActivity(PermissionIntents.appDetails(context), PackageManager.MATCH_DEFAULT_ONLY) != null
            assertTrue("No settings screen for $kind", resolves)
        }
    }

    @Test
    fun overlayRequirementMatchesApiLevel() {
        val overlayItem = PermissionChecks.snapshot(context).items().first { it.kind == PermissionKind.OVERLAY }
        assertEquals(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q, overlayItem.required)
    }
}
