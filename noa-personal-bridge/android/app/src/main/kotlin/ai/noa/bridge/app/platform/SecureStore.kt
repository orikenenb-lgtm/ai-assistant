package ai.noa.bridge.app.platform

import ai.noa.bridge.app.ExclusionEntry
import android.content.Context
import android.content.SharedPreferences
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/**
 * Encrypted key/value storage (SharedPreferences "noa_bridge_secure"; every value is encrypted
 * with [SecretCipher]): device token, device id, backend base URL, and the exclusion list (display
 * names are personal data). The preferences file is excluded from backup and device transfer.
 */
class SecureStore(
    private val context: Context,
    private val cipher: SecretCipher,
    private val prefsName: String = PREFS_NAME,
) {
    private val lock = Any()
    private val prefs: SharedPreferences
        get() = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    var deviceToken: String?
        get() = read(KEY_TOKEN)
        set(value) = write(KEY_TOKEN, value)

    var deviceId: String?
        get() = read(KEY_DEVICE_ID)
        set(value) = write(KEY_DEVICE_ID, value)

    var baseUrl: String?
        get() = read(KEY_BASE_URL)
        set(value) = write(KEY_BASE_URL, value)

    fun exclusions(): List<ExclusionEntry> {
        val raw = read(KEY_EXCLUSIONS) ?: return emptyList()
        return try {
            json.decodeFromString<List<StoredExclusion>>(raw).map { ExclusionEntry(it.key, it.name) }
        } catch (e: SerializationException) {
            SafeLog.e(SafeLog.Event.SECURE_STORE_DECRYPT_FAILED, e)
            emptyList()
        } catch (e: IllegalArgumentException) {
            SafeLog.e(SafeLog.Event.SECURE_STORE_DECRYPT_FAILED, e)
            emptyList()
        }
    }

    fun setExclusions(entries: List<ExclusionEntry>) {
        write(KEY_EXCLUSIONS, json.encodeToString(entries.map { StoredExclusion(it.conversationKeyValue, it.displayName) }))
    }

    fun clearCredentials() = synchronized(lock) {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_DEVICE_ID).commit()
        Unit
    }

    /** Deletes the preferences file and the keystore key. */
    fun wipeAll() = synchronized(lock) {
        prefs.edit().clear().commit()
        context.deleteSharedPreferences(prefsName)
        cipher.destroyKey()
    }

    private fun read(key: String): String? = synchronized(lock) {
        val encrypted = prefs.getString(key, null) ?: return null
        cipher.decrypt(encrypted)
    }

    private fun write(key: String, value: String?) = synchronized(lock) {
        val editor = prefs.edit()
        if (value == null) editor.remove(key) else editor.putString(key, cipher.encrypt(value))
        editor.commit()
        Unit
    }

    @Serializable
    private data class StoredExclusion(@SerialName("k") val key: String, @SerialName("n") val name: String)

    companion object {
        const val PREFS_NAME = "noa_bridge_secure"
        private const val KEY_TOKEN = "device_token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_EXCLUSIONS = "exclusions"
        private val json = Json { ignoreUnknownKeys = true }
    }
}
