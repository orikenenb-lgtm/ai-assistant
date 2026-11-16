package ai.noa.bridge.app.platform

import ai.noa.bridge.app.OpenInWhatsAppResult
import ai.noa.bridge.core.ConversationFilter
import ai.noa.bridge.core.ConversationKey
import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.core.net.toUri
import android.os.Build
import android.os.Bundle
import android.os.PersistableBundle

/**
 * D-020: opens a conversation INSIDE WhatsApp so the user sends the reply with WhatsApp's own send
 * button. Uses only public, documented mechanisms:
 * - WhatsApp's click-to-chat link (`https://api.whatsapp.com/send?phone=…&text=…`) restricted to
 *   the `com.whatsapp` package, when the chat's phone number is known from its JID;
 * - otherwise the clipboard (marked sensitive) plus WhatsApp's own notification contentIntent.
 *
 * It never sends anything, never touches WhatsApp's UI and never logs the number or the text.
 * Must be used while one of our activities is in the foreground (background-activity-start rules).
 */
class WhatsAppOpener(
    private val context: Context,
    private val registry: ReplyActionRegistry,
) {

    /**
     * The click-to-chat intent for [key] with [text] pre-typed, or null when the chat's phone number
     * is unknown (an `@lid` chat, or no notification seen since the process started).
     */
    fun buildOpenIntent(key: ConversationKey, text: String): Intent? {
        val phone = registry.chatTarget(key)?.phoneDigits ?: return null
        return buildOpenIntent(phone, text)
    }

    /** Opens the chat of [key] with [text]: pre-typed when possible, else copied + chat opened. */
    fun open(key: ConversationKey, text: String): OpenInWhatsAppResult {
        val direct = buildOpenIntent(key, text)
        if (direct != null) {
            try {
                context.startActivity(direct)
                SafeLog.i(SafeLog.Event.OPEN_IN_WHATSAPP_WITH_TEXT)
                return OpenInWhatsAppResult.OPENED_WITH_TEXT
            } catch (e: RuntimeException) {
                // ActivityNotFoundException (WhatsApp missing / link not handled), SecurityException…
                SafeLog.e(SafeLog.Event.OPEN_IN_WHATSAPP_FAILED, e)
            }
        }
        copySensitive(context, text)
        val contentIntent = registry.chatTarget(key)?.contentIntent
        if (contentIntent != null && sendContentIntent(contentIntent)) {
            SafeLog.i(SafeLog.Event.OPEN_IN_WHATSAPP_CHAT_COPIED)
            return OpenInWhatsAppResult.OPENED_CHAT_TEXT_COPIED
        }
        SafeLog.w(SafeLog.Event.OPEN_IN_WHATSAPP_NOT_FOUND)
        return OpenInWhatsAppResult.CHAT_NOT_FOUND_TEXT_COPIED
    }

    /**
     * Sends WhatsApp's own "open this chat" PendingIntent. On Android 14+ the sender must opt in to
     * lend its foreground (visible activity) privilege to the activity start.
     */
    private fun sendContentIntent(pendingIntent: PendingIntent): Boolean = try {
        pendingIntent.send(context, 0, null, null, null, null, activityStartOptions())
        true
    } catch (e: PendingIntent.CanceledException) {
        // WhatsApp withdrew the notification's intent.
        SafeLog.e(SafeLog.Event.OPEN_IN_WHATSAPP_FAILED, e)
        false
    } catch (e: RuntimeException) {
        SafeLog.e(SafeLog.Event.OPEN_IN_WHATSAPP_FAILED, e)
        false
    }

    @Suppress("DEPRECATION")
    private fun activityStartOptions(): Bundle? = when {
        Build.VERSION.SDK_INT >= 36 -> ActivityOptions.makeBasic()
            .setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE)
            .toBundle()
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> ActivityOptions.makeBasic()
            .setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
            .toBundle()
        else -> null
    }

    companion object {
        const val WHATSAPP_PACKAGE: String = ConversationFilter.WHATSAPP_PACKAGE
        private const val CLICK_TO_CHAT = "https://api.whatsapp.com/send"

        /**
         * `https://api.whatsapp.com/send?phone=<digits>&text=<percent-encoded UTF-8>` for the
         * `com.whatsapp` package only (never a browser, never WhatsApp Business), in a new task.
         * [phoneDigits] must be digits only (E.164 without '+').
         */
        fun buildOpenIntent(phoneDigits: String, text: String): Intent? {
            if (phoneDigits.isEmpty() || !phoneDigits.all { it in '0'..'9' }) return null
            val uri = CLICK_TO_CHAT.toUri().buildUpon()
                .appendQueryParameter("phone", phoneDigits)
                .appendQueryParameter("text", text)
                .build()
            return Intent(Intent.ACTION_VIEW, uri)
                .setPackage(WHATSAPP_PACKAGE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        /** Copies [text], flagged as sensitive so Android 13+ hides it from the clipboard preview. */
        fun copySensitive(context: Context, text: String) {
            val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
            val clip = ClipData.newPlainText("reply", text)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
            }
            clipboard.setPrimaryClip(clip)
        }
    }
}
