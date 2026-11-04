package com.disciplineos.app.data.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.disciplineos.app.data.prefs.PrefKeys
import com.disciplineos.app.data.prefs.safeData
import com.disciplineos.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Encrypts small secrets (e.g. a per-device backend token) with an AES-256-GCM key that lives in the
 * Android Keystore. The key is generated inside the Keystore and is non-exportable; only ciphertext
 * (Base64 of 12-byte IV || ciphertext+tag) is written to DataStore under `secure.<name>`.
 *
 * Guarantees / limits (honest):
 * - Protects secrets at rest against file-level extraction (backups are disabled anyway; see docs/DATABASE.md).
 * - Does NOT protect against code running inside this app's process or a rooted device with Keystore access.
 * - If the key is lost/invalidated (e.g. Keystore reset), stored values become unreadable and [get] returns null;
 *   callers must re-provision (e.g. re-register the device token).
 * - Values are never logged.
 */
@Singleton
class SecureStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    @IoDispatcher private val io: CoroutineDispatcher,
) {

    suspend fun put(name: String, value: String?) {
        val key = prefKey(name)
        if (value == null) {
            dataStore.edit { it.remove(key) }
            return
        }
        val blob = withContext(io) { encrypt(value.toByteArray(Charsets.UTF_8)) }
        dataStore.edit { it[key] = blob }
    }

    suspend fun get(name: String): String? {
        val key = prefKey(name)
        val blob = dataStore.safeData().first()[key] ?: return null
        return withContext(io) {
            try {
                String(decrypt(blob), Charsets.UTF_8)
            } catch (e: KeyPermanentlyInvalidatedException) {
                null
            } catch (e: GeneralSecurityException) {
                // Wrong key / tampered blob (AEADBadTagException is a GeneralSecurityException).
                null
            } catch (e: IllegalArgumentException) {
                // Malformed Base64 / too short.
                null
            }
        }
    }

    /** Removes every secure entry and deletes the Keystore key (used by "delete all my data"). */
    suspend fun clearAll() {
        dataStore.edit { prefs ->
            prefs.asMap().keys
                .filter { it.name.startsWith(PrefKeys.SECURE_PREFIX) }
                .forEach { prefs.remove(it) }
        }
        withContext(io) {
            try {
                keyStore().deleteEntry(KEY_ALIAS)
            } catch (e: GeneralSecurityException) {
                // Nothing to delete or Keystore unavailable; ciphertexts are already gone.
            }
        }
    }

    private fun prefKey(name: String): Preferences.Key<String> {
        require(name.isNotBlank() && name.length <= 64 && name.all { it.isLetterOrDigit() || it == '_' || it == '.' }) {
            "Invalid secure entry name"
        }
        return stringPreferencesKey(PrefKeys.SECURE_PREFIX + name)
    }

    private fun encrypt(plain: ByteArray): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv // Keystore generates a fresh random 12-byte IV for every encryption.
        val ct = cipher.doFinal(plain)
        return Base64.getEncoder().encodeToString(iv + ct)
    }

    private fun decrypt(blob: String): ByteArray {
        val bytes = Base64.getDecoder().decode(blob)
        require(bytes.size > IV_BYTES) { "Ciphertext too short" }
        val iv = bytes.copyOfRange(0, IV_BYTES)
        val ct = bytes.copyOfRange(IV_BYTES, bytes.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_BITS, iv))
        return cipher.doFinal(ct)
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    @Synchronized
    private fun getOrCreateKey(): SecretKey {
        (keyStore().getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    companion object {
        /** Well-known entry names. */
        const val BACKEND_DEVICE_TOKEN = "backend_device_token"

        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "discipline_os_secure_store_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128
    }
}
