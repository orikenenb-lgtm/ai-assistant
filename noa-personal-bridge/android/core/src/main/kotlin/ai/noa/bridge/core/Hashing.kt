package ai.noa.bridge.core

import java.security.MessageDigest

/** Small hashing helpers shared by the core. Never logs its input. */
internal object Hashing {
    private val HEX = "0123456789abcdef".toCharArray()

    fun sha256(input: String): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))

    /** Lower-case hex SHA-256 of the UTF-8 bytes of [input] (64 chars). */
    fun sha256Hex(input: String): String = sha256(input).toHex()

    fun ByteArray.toHex(): String {
        val out = CharArray(size * 2)
        for (i in indices) {
            val b = this[i].toInt() and 0xff
            out[i * 2] = HEX[b ushr 4]
            out[i * 2 + 1] = HEX[b and 0x0f]
        }
        return String(out)
    }

    /** Constant-time comparison of two hex digests (avoids timing side channels). */
    fun constantTimeEquals(a: String, b: String): Boolean =
        MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))
}
