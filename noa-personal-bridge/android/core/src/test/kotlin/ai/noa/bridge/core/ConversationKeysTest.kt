package ai.noa.bridge.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationKeysTest {
    private val hex64 = Regex("^[0-9a-f]{64}$")

    @Test fun keyIsStableAndHashed() {
        val a = keyOf(snapshot(messages = listOf(msg("one", 1))))
        val b = keyOf(snapshot(messages = listOf(msg("two", 2)), title = "Renamed"))
        assertEquals(a, b)
        assertTrue(hex64.matches(a.value))
        assertFalse(a.value.contains("972501234567"))
        assertFalse(a.toString().contains("972501234567"))
        assertEquals(Hashing.sha256Hex("com.whatsapp|$CONTACT_JID"), a.value)
    }

    @Test fun identityPriority() {
        val withShortcut = snapshot(shortcutId = "sc-1", tag = "tag-1", conversationTitle = "ct", title = "t")
        assertEquals(Hashing.sha256Hex("com.whatsapp|sc-1"), keyOf(withShortcut).value)
        val withTag = snapshot(shortcutId = " ", tag = "tag-1", conversationTitle = "ct", title = "t")
        assertEquals(Hashing.sha256Hex("com.whatsapp|tag-1"), keyOf(withTag).value)
        val withConvTitle = snapshot(shortcutId = null, tag = "", conversationTitle = "ct", title = "t")
        assertEquals(Hashing.sha256Hex("com.whatsapp|ct"), keyOf(withConvTitle).value)
        val withTitle = snapshot(shortcutId = null, tag = null, conversationTitle = null, title = "Dana")
        assertEquals(Hashing.sha256Hex("com.whatsapp|Dana"), keyOf(withTitle).value)
        assertFalse(keyOf(withTitle).value.contains("Dana"))
    }

    @Test fun nullWhenNoIdentity() {
        assertNull(ConversationKeys.derive(snapshot(tag = null, shortcutId = "", title = " ", conversationTitle = null)))
    }

    @Test fun differentConversationsAndPackagesDiffer() {
        assertNotEquals(keyOf(snapshot(tag = CONTACT_JID)), keyOf(snapshot(tag = OTHER_JID)))
        assertNotEquals(keyOf(snapshot()), keyOf(snapshot(packageName = "com.whatsapp.w4b")))
    }

    @Test fun eventIdsAreDeterministicAndContentFree() {
        val key = keyOf(snapshot())
        val m = msg("secret text", 42)
        assertEquals(EventIds.of(key, m), EventIds.of(key, m.copy()))
        assertNotEquals(EventIds.of(key, m), EventIds.of(key, m.copy(timestampMillis = 43)))
        assertNotEquals(EventIds.of(key, m), EventIds.of(key, m.copy(text = "other")))
        assertNotEquals(EventIds.of(key, m), EventIds.of(key, m.copy(sender = "Other")))
        assertNotEquals(EventIds.of(key, m), EventIds.of(keyOf(snapshot(tag = OTHER_JID)), m))
        assertTrue(hex64.matches(EventIds.of(key, m)))
        assertFalse(EventIds.of(key, m).contains("secret"))
    }
}
