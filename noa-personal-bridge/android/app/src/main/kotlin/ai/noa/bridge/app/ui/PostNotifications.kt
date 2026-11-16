package ai.noa.bridge.app.ui

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.components.ConfirmDialog
import ai.noa.bridge.app.ui.onboarding.OnboardingStore
import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/** Handle returned by [rememberPostNotificationsRequester]. */
fun interface PostNotificationsRequester {
    fun request()
}

/**
 * POST_NOTIFICATIONS flow (Android 13+): explain first, then ask through the Activity Result API.
 * If the user already declined permanently, opens the app's notification settings instead.
 * Also shows the explanation once automatically after onboarding.
 */
@Composable
fun rememberPostNotificationsRequester(
    controller: AppController,
    store: OnboardingStore,
    autoPrompt: Boolean,
): PostNotificationsRequester {
    val context = LocalContext.current
    var showRationale by rememberSaveable { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        controller.refreshPermissions()
    }

    LaunchedEffect(autoPrompt) {
        if (autoPrompt && Build.VERSION.SDK_INT >= 33 && !store.postNotificationsAsked && !isGranted(context)) {
            showRationale = true
        }
    }

    if (showRationale) {
        ConfirmDialog(
            title = stringResource(R.string.postnotif_rationale_title),
            body = stringResource(R.string.postnotif_rationale_body),
            confirmLabel = stringResource(R.string.postnotif_rationale_confirm),
            dismissLabel = stringResource(R.string.postnotif_rationale_decline),
            onConfirm = {
                showRationale = false
                store.markPostNotificationsAsked()
                if (Build.VERSION.SDK_INT >= 33) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
            },
            onDismiss = {
                showRationale = false
                store.markPostNotificationsAsked()
            },
        )
    }

    return remember(context, store) {
        PostNotificationsRequester {
            when {
                isGranted(context) -> controller.refreshPermissions()
                Build.VERSION.SDK_INT < 33 -> openAppNotificationSettings(context)
                store.postNotificationsAsked && !shouldShowRationale(context) -> openAppNotificationSettings(context)
                else -> showRationale = true
            }
        }
    }
}

private fun isGranted(context: Context): Boolean =
    Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

private fun shouldShowRationale(context: Context): Boolean {
    val activity = context.findActivity() ?: return true
    return Build.VERSION.SDK_INT >= 33 &&
        ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.POST_NOTIFICATIONS)
}

private fun openAppNotificationSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
