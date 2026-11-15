package ai.noa.bridge.app

import ai.noa.bridge.app.platform.PlatformGraph
import ai.noa.bridge.app.platform.SafeLog
import android.app.Application
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Process-wide singletons. The UI obtains the controller with
 * `(context.applicationContext as BridgeApplication).controller`; the notification listener
 * obtains the ingestor (coordinator + reply registry) from [platform].
 *
 * onCreate does no work: everything is created lazily on first use.
 */
class BridgeApplication : Application() {

    /** Application scope. A failing child never cancels siblings and never crashes the process. */
    val appScope: CoroutineScope = CoroutineScope(
        SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, error ->
            SafeLog.e(SafeLog.Event.COROUTINE_FAILURE, error)
        },
    )

    internal val platform: PlatformGraph by lazy { PlatformGraph(this, appScope) }

    val controller: AppController by lazy { platform.controller }
}
