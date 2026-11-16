package ai.noa.bridge.app

import ai.noa.bridge.app.platform.DraftNotifier
import ai.noa.bridge.app.platform.SafeLog
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.annotation.VisibleForTesting

/**
 * D-020: the target of our "draft ready" notification. A translucent, UI-less, NOT exported
 * activity (PendingIntent.getActivity — notification trampolines through a receiver/service are
 * blocked on Android 12+). Being a started activity, it is in the foreground, so it may start
 * WhatsApp.
 *
 * It reads the draft id from the intent and asks the controller to open the chat in WhatsApp with
 * the draft's CURRENT stored text (looked up by id at tap time, so the text can never be stale).
 * On failure it opens [MainActivity] at that draft. It never approves or sends anything.
 */
class OpenInWhatsAppActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val draftId = intent?.getStringExtra(DraftNotifier.EXTRA_DRAFT_ID)?.takeIf { it.isNotBlank() }
        val result = if (draftId == null) null else openInWhatsApp(draftId)
        when (result) {
            OpenInWhatsAppResult.OPENED_WITH_TEXT -> Unit
            OpenInWhatsAppResult.OPENED_CHAT_TEXT_COPIED -> toast(R.string.open_whatsapp_copied_paste)
            OpenInWhatsAppResult.CHAT_NOT_FOUND_TEXT_COPIED -> {
                toast(R.string.open_whatsapp_not_found_copied)
                openInApp(draftId)
            }
            else -> openInApp(draftId)
        }
        finish()
    }

    private fun openInWhatsApp(draftId: String): OpenInWhatsAppResult? = try {
        val controller = controllerForTests ?: (application as? BridgeApplication)?.controller
        controller?.openInWhatsApp(draftId)
    } catch (e: RuntimeException) {
        SafeLog.e(SafeLog.Event.OPEN_IN_WHATSAPP_FAILED, e)
        null
    }

    private fun openInApp(draftId: String?) {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (draftId != null) intent.putExtra(DraftNotifier.EXTRA_DRAFT_ID, draftId)
        startActivity(intent)
    }

    private fun toast(res: Int) {
        Toast.makeText(applicationContext, res, Toast.LENGTH_LONG).show()
    }

    companion object {
        /** Robolectric tests only: the controller to use instead of BridgeApplication's. */
        @VisibleForTesting
        @Volatile
        internal var controllerForTests: AppController? = null
    }
}
