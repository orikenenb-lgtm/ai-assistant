package ai.noa.bridge.app.platform

import ai.noa.bridge.core.ConversationKey
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The `conversation_ref` sent to the bridge backend (S-M4).
 *
 * The local [ConversationKey] is `sha256("com.whatsapp|<jid>")` — unsalted, so anyone who sees it
 * can recover the phone number by enumerating the (small) number space. The wire value is instead
 * `hex(HMAC-SHA256(secret, conversationKey.value))` with a random 32-byte secret generated once per
 * install and kept encrypted in [SecureStore] (regenerated after "wipe local data"). Without the
 * secret the ref cannot be linked to a phone number; it is still 64 lower-case hex chars and stable
 * per conversation, so API_CONTRACT.md is unchanged.
 */
object ConversationRefs {
    const val SECRET_BYTES = 32
    private const val ALGORITHM = "HmacSHA256"
    private val HEX = "0123456789abcdef".toCharArray()

    fun newSecret(random: SecureRandom = SecureRandom()): ByteArray = ByteArray(SECRET_BYTES).also(random::nextBytes)

    fun of(secret: ByteArray, key: ConversationKey): String {
        require(secret.size == SECRET_BYTES) { "secret must be $SECRET_BYTES bytes" }
        val mac = Mac.getInstance(ALGORITHM)
        mac.init(SecretKeySpec(secret, ALGORITHM))
        val digest = mac.doFinal(key.value.toByteArray(Charsets.UTF_8))
        val out = CharArray(digest.size * 2)
        for (i in digest.indices) {
            val b = digest[i].toInt() and 0xff
            out[i * 2] = HEX[b ushr 4]
            out[i * 2 + 1] = HEX[b and 0x0f]
        }
        return String(out)
    }
}
