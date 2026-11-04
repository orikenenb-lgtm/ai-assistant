package com.disciplineos.app.ai

import com.disciplineos.core.domain.time.TimeProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class SupabaseAnonymousTokenProviderTest {

    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient
    private val storage = MapStorage()
    private val clock = MutableTime(Instant.parse("2026-11-04T10:00:00Z"))
    private val t0 get() = clock.now.epochSecond

    private class MapStorage : SecretStorage {
        val map = ConcurrentHashMap<String, String>()
        var puts = 0
        override suspend fun get(name: String): String? = map[name]
        override suspend fun put(name: String, value: String?) {
            puts++
            if (value == null) map.remove(name) else map[name] = value
        }
    }

    private class MutableTime(var now: Instant) : TimeProvider {
        override fun now(): Instant = now
        override fun zone(): ZoneId = ZoneId.of("Asia/Jerusalem")
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .followRedirects(false)
            .retryOnConnectionFailure(false)
            .build()
    }

    @After
    fun tearDown() {
        client.dispatcher.cancelAll()
        server.shutdown()
    }

    private fun config(
        url: String = server.url("/").toString(),
        anonKey: String = ANON_KEY,
        cleartext: Set<String> = setOf(server.hostName),
    ) = SupabaseAuthConfig(supabaseUrl = url, anonKey = anonKey, cleartextHostsAllowed = cleartext)

    private fun provider(cfg: SupabaseAuthConfig = config()) = SupabaseAnonymousTokenProvider(client, cfg, storage, clock)

    private fun session(access: String, refresh: String, expiresAt: Long? = null, expiresIn: Long? = 3600): MockResponse {
        val fields = buildList {
            add("\"access_token\":\"$access\"")
            add("\"token_type\":\"bearer\"")
            expiresIn?.let { add("\"expires_in\":$it") }
            expiresAt?.let { add("\"expires_at\":$it") }
            add("\"refresh_token\":\"$refresh\"")
            add("\"user\":{\"id\":\"00000000-0000-0000-0000-000000000000\",\"is_anonymous\":true}")
        }
        return MockResponse().setHeader("Content-Type", "application/json").setBody(fields.joinToString(",", "{", "}"))
    }

    private fun token(p: SupabaseAnonymousTokenProvider): String? = runBlocking { withTimeout(10_000) { p.token() } }

    private fun take(): RecordedRequest = server.takeRequest(2, TimeUnit.SECONDS)!!

    private fun stored() = Json.parseToJsonElement(storage.map.getValue(SupabaseAnonymousTokenProvider.SESSION_KEY)).jsonObject

    @Test
    fun signUpStoresSessionAndReturnsAccessToken() {
        server.enqueue(session(JWT_1, "refresh-1", expiresAt = t0 + 3600))
        assertEquals(JWT_1, token(provider()))

        val req = take()
        assertEquals("POST", req.method)
        assertEquals("/auth/v1/signup", req.path)
        assertEquals(ANON_KEY, req.getHeader("apikey"))
        assertNull("the anon key goes in apikey only", req.getHeader("Authorization"))
        assertTrue(req.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals("{}", req.body.readUtf8())

        val blob = stored()
        assertEquals(JWT_1, blob["access_token"]!!.jsonPrimitive.content)
        assertEquals("refresh-1", blob["refresh_token"]!!.jsonPrimitive.content)
        assertEquals(t0 + 3600, blob["expires_at"]!!.jsonPrimitive.long)
    }

    @Test
    fun expiresInIsUsedWhenExpiresAtMissing() {
        server.enqueue(session(JWT_1, "refresh-1", expiresAt = null, expiresIn = 1800))
        assertEquals(JWT_1, token(provider()))
        assertEquals(t0 + 1800, stored()["expires_at"]!!.jsonPrimitive.long)
    }

    @Test
    fun cachedTokenIsReusedWithoutNetwork_andSurvivesProcessRestart() {
        server.enqueue(session(JWT_1, "refresh-1", expiresAt = t0 + 3600))
        val p = provider()
        assertEquals(JWT_1, token(p))
        clock.now = clock.now.plusSeconds(3000) // still > 60s left
        assertEquals(JWT_1, token(p))
        assertEquals(JWT_1, token(provider())) // new instance, same SecureStore
        assertEquals(1, server.requestCount)
    }

    @Test
    fun refreshesWithin60SecondsOfExpiry() {
        server.enqueue(session(JWT_1, "refresh-1", expiresAt = t0 + 3600))
        server.enqueue(session(JWT_2, "refresh-2", expiresAt = t0 + 3550 + 3600))
        val p = provider()
        assertEquals(JWT_1, token(p))
        clock.now = clock.now.plusSeconds(3550) // 50s left → refresh
        assertEquals(JWT_2, token(p))

        take() // sign-up
        val refresh = take()
        assertEquals("POST", refresh.method)
        assertEquals("/auth/v1/token?grant_type=refresh_token", refresh.path)
        assertEquals(ANON_KEY, refresh.getHeader("apikey"))
        assertEquals("refresh-1", Json.parseToJsonElement(refresh.body.readUtf8()).jsonObject["refresh_token"]!!.jsonPrimitive.content)
        assertEquals(JWT_2, stored()["access_token"]!!.jsonPrimitive.content)
        assertEquals("refresh-2", stored()["refresh_token"]!!.jsonPrimitive.content)
    }

    @Test
    fun refreshRejectedWith400Or401SignsUpAgain() {
        for (code in listOf(400, 401)) {
            storage.map.clear()
            server.enqueue(session(JWT_1, "refresh-1", expiresAt = t0 + 30)) // already inside the refresh margin
            server.enqueue(MockResponse().setResponseCode(code).setBody("""{"error":"invalid_grant"}"""))
            server.enqueue(session(JWT_2, "refresh-2", expiresAt = t0 + 3600))
            val p = provider()
            assertEquals(JWT_1, token(p))
            assertEquals("after $code", JWT_2, token(p))
            assertEquals("/auth/v1/signup", take().path)
            assertEquals("/auth/v1/token?grant_type=refresh_token", take().path)
            assertEquals("/auth/v1/signup", take().path)
            assertEquals("refresh-2", stored()["refresh_token"]!!.jsonPrimitive.content)
        }
    }

    @Test
    fun transientRefreshFailureKeepsStillValidToken_butNotAnExpiredOne() {
        server.enqueue(session(JWT_1, "refresh-1", expiresAt = t0 + 3600))
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setResponseCode(503))
        val p = provider()
        assertEquals(JWT_1, token(p))
        clock.now = clock.now.plusSeconds(3570) // 30s left, refresh fails transiently → keep using it
        assertEquals(JWT_1, token(p))
        clock.now = clock.now.plusSeconds(60) // expired, refresh fails again → no token (no sign-up on 5xx)
        assertNull(token(p))
        assertEquals(3, server.requestCount)
        assertTrue("session is kept for a later refresh", storage.map.containsKey(SupabaseAnonymousTokenProvider.SESSION_KEY))
    }

    @Test
    fun concurrentCallsCauseExactlyOneNetworkRequest() {
        server.enqueue(session(JWT_1, "refresh-1", expiresAt = t0 + 3600).setBodyDelay(300, TimeUnit.MILLISECONDS))
        val p = provider()
        val tokens = runBlocking(Dispatchers.Default) {
            withTimeout(10_000) { List(16) { async { p.token() } }.awaitAll() }
        }
        assertEquals(List(16) { JWT_1 }, tokens)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun nonHttpsUrlIsRejectedWithoutNetwork() {
        val p = provider(config(cleartext = emptySet())) // http://localhost:port/ without a debug exemption
        assertNull(token(p))
        assertEquals(0, server.requestCount)
        assertNull(SupabaseAuthConfig("ftp://example.com", ANON_KEY).baseUrl())
        assertNull(SupabaseAuthConfig("https://user:pw@example.supabase.co", ANON_KEY).baseUrl())
        assertEquals("https://example.supabase.co/", SupabaseAuthConfig("https://example.supabase.co", ANON_KEY).baseUrl().toString())
    }

    @Test
    fun blankConfigurationIsNotConfiguredAndMakesNoRequest() {
        assertFalse(SupabaseAuthConfig("", ANON_KEY).isConfigured)
        assertFalse(SupabaseAuthConfig("https://example.supabase.co", " ").isConfigured)
        assertTrue(SupabaseAuthConfig("https://example.supabase.co", ANON_KEY).isConfigured)
        assertNull(token(provider(config(anonKey = ""))))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun malformedOrFailedSignUpReturnsNullAndStoresNothing() {
        server.enqueue(session("not a jwt", "refresh-1", expiresAt = t0 + 3600))
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"access_token":"$JWT_1"}"""))
        server.enqueue(MockResponse().setBody("<html>captive portal</html>"))
        server.enqueue(MockResponse().setResponseCode(422).setBody("""{"msg":"Anonymous sign-ins are disabled"}"""))
        val p = provider()
        repeat(4) { assertNull(token(p)) }
        assertTrue(storage.map.isEmpty())
    }

    @Test
    fun invalidateForcesRefreshOnlyForTheRejectedToken() {
        server.enqueue(session(JWT_1, "refresh-1", expiresAt = t0 + 3600))
        server.enqueue(session(JWT_2, "refresh-2", expiresAt = t0 + 7200))
        val p = provider()
        assertEquals(JWT_1, token(p))
        runBlocking { p.invalidate("some.other.token") }
        assertEquals(JWT_1, token(p))
        assertEquals(1, server.requestCount)
        runBlocking { p.invalidate(JWT_1) }
        assertEquals(JWT_2, token(p))
        take()
        assertEquals("/auth/v1/token?grant_type=refresh_token", take().path)
    }

    @Test
    fun sessionOfAnotherProjectIsIgnored() {
        server.enqueue(session(JWT_1, "refresh-1", expiresAt = t0 + 3600))
        server.enqueue(session(JWT_2, "refresh-2", expiresAt = t0 + 3600))
        assertEquals(JWT_1, token(provider()))
        // Same storage, build re-pointed to another project path → must not reuse project A's token.
        assertEquals(JWT_2, token(provider(config(url = server.url("/other-project/").toString()))))
        take()
        assertEquals("/other-project/auth/v1/signup", take().path)
    }

    @Test
    fun corruptedStoredBlobIsTreatedAsNoSession() {
        storage.map[SupabaseAnonymousTokenProvider.SESSION_KEY] = "{not json"
        server.enqueue(session(JWT_1, "refresh-1", expiresAt = t0 + 3600))
        assertEquals(JWT_1, token(provider()))
        assertEquals("/auth/v1/signup", take().path)
    }

    @Test
    fun toStringNeverContainsSecrets() {
        assertFalse(config().toString().contains(ANON_KEY))
        assertFalse(StoredSession("https://x/", JWT_1, "refresh-1", 1).toString().contains(JWT_1))
        assertFalse(StoredSession("https://x/", JWT_1, "refresh-1", 1).toString().contains("refresh-1"))
    }

    private companion object {
        // Placeholders shaped like the real things; not real credentials.
        const val ANON_KEY = "sb_publishable_TEST_PLACEHOLDER"
        const val JWT_1 = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnLTE"
        const val JWT_2 = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIyIn0.c2lnLTI"
    }
}
