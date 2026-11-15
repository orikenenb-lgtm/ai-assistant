package ai.noa.bridge.app.ui

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.BridgeApplication
import android.content.Context

/** Where the UI's controller came from. */
sealed interface ControllerSource {
    val controller: AppController

    /** The real platform controller from [BridgeApplication]. */
    data class Real(override val controller: AppController) : ControllerSource

    /**
     * No BridgeApplication (e.g. a test harness Application). The UI then refuses to show any data
     * as real: the caller must render it in preview mode with a permanent banner.
     */
    data class Unavailable(override val controller: AppController) : ControllerSource
}

object ControllerProvider {
    /**
     * Returns the process-wide controller exposed by [BridgeApplication.controller].
     * [fallback] is only used when the application object is not a BridgeApplication.
     */
    fun from(context: Context, fallback: () -> AppController): ControllerSource {
        val app = context.applicationContext as? BridgeApplication
        return if (app != null) ControllerSource.Real(app.controller) else ControllerSource.Unavailable(fallback())
    }
}
