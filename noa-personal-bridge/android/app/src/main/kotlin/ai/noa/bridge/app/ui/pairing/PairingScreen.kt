package ai.noa.bridge.app.ui.pairing

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.PairingResult
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.components.BannerKind
import ai.noa.bridge.app.ui.components.MinTouchTarget
import ai.noa.bridge.app.ui.components.NoticeBanner
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.net.URI

/** Pure validation so it can be unit tested without Compose. */
object PairingValidation {
    const val CODE_LENGTH = 8
    private val codeRegex = Regex("^[A-Za-z0-9]{$CODE_LENGTH}$")

    fun normalizeUrl(input: String): String = input.trim().trimEnd('/')

    fun isValidBaseUrl(input: String): Boolean {
        val url = normalizeUrl(input)
        if (!url.startsWith("https://", ignoreCase = true) || url.any { it.isWhitespace() }) return false
        return runCatching { URI(url) }.getOrNull()?.let { uri ->
            uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank() && uri.userInfo == null
        } ?: false
    }

    /** Keeps only ASCII letters/digits, max [CODE_LENGTH] characters. */
    fun sanitizeCode(input: String): String =
        input.filter { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' }.take(CODE_LENGTH)

    fun isValidCode(code: String): Boolean = codeRegex.matches(code)
}

private sealed interface PairingUi {
    data object Idle : PairingUi
    data object InProgress : PairingUi
    data object Success : PairingUi
    data class Failure(val message: String?) : PairingUi
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PairingScreen(
    controller: AppController,
    status: BridgeStatus,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var url by rememberSaveable { mutableStateOf(status.backendBaseUrl ?: "https://") }
    var code by rememberSaveable { mutableStateOf("") }
    var showErrors by rememberSaveable { mutableStateOf(false) }
    // Not saved: an in-flight pairing does not survive recreation, so the screen restarts at Idle.
    var ui by androidx.compose.runtime.remember { mutableStateOf<PairingUi>(PairingUi.Idle) }

    val urlValid = PairingValidation.isValidBaseUrl(url)
    val codeValid = PairingValidation.isValidCode(code)
    val inProgress = ui == PairingUi.InProgress

    fun submit() {
        showErrors = true
        if (!urlValid || !codeValid || inProgress) return
        ui = PairingUi.InProgress
        val baseUrl = PairingValidation.normalizeUrl(url)
        scope.launch {
            ui = try {
                when (val r = controller.pair(baseUrl, code)) {
                    PairingResult.Success -> PairingUi.Success
                    is PairingResult.Failure -> PairingUi.Failure(r.messageHebrew.takeIf { it.isNotBlank() })
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                PairingUi.Failure(null)
            }
            if (ui == PairingUi.Success) code = ""
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.pairing_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack, modifier = Modifier.testTag("backButton")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
            )
        },
    ) { inner ->
        Column(
            Modifier
                .padding(inner)
                .consumeWindowInsets(inner)
                .imePadding()
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(stringResource(R.string.pairing_intro), style = MaterialTheme.typography.bodyLarge)
            if (status.paired && status.backendBaseUrl != null) {
                NoticeBanner(BannerKind.INFO, stringResource(R.string.pairing_already_paired, status.backendBaseUrl))
            }

            // URLs and codes are Latin: force LTR inside the field even though the screen is RTL.
            OutlinedTextField(
                value = url,
                onValueChange = { url = it; if (ui is PairingUi.Failure) ui = PairingUi.Idle },
                label = { Text(stringResource(R.string.pairing_url_label)) },
                placeholder = { Text(stringResource(R.string.pairing_url_placeholder)) },
                singleLine = true,
                enabled = !inProgress,
                isError = showErrors && !urlValid,
                supportingText = if (showErrors && !urlValid) { { Text(stringResource(R.string.pairing_url_error)) } } else null,
                textStyle = MaterialTheme.typography.bodyLarge.copy(textDirection = TextDirection.Ltr),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth().testTag("pairingUrl"),
            )
            OutlinedTextField(
                value = code,
                onValueChange = { code = PairingValidation.sanitizeCode(it); if (ui is PairingUi.Failure) ui = PairingUi.Idle },
                label = { Text(stringResource(R.string.pairing_code_label)) },
                singleLine = true,
                enabled = !inProgress,
                isError = showErrors && !codeValid,
                supportingText = {
                    Text(
                        if (showErrors && !codeValid) stringResource(R.string.pairing_code_error)
                        else stringResource(R.string.pairing_code_supporting, code.length),
                    )
                },
                textStyle = MaterialTheme.typography.titleLarge.copy(textDirection = TextDirection.Ltr),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Done,
                    autoCorrectEnabled = false,
                ),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { submit() }),
                modifier = Modifier.fillMaxWidth().testTag("pairingCode"),
            )

            Button(
                onClick = ::submit,
                enabled = !inProgress,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("pairingSubmit"),
                shape = MaterialTheme.shapes.medium,
            ) {
                if (inProgress) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    Spacer(Modifier.width(10.dp))
                    Text(stringResource(R.string.pairing_in_progress))
                } else {
                    Text(stringResource(R.string.pairing_submit), style = MaterialTheme.typography.titleMedium)
                }
            }

            when (val state = ui) {
                PairingUi.Idle, PairingUi.InProgress -> Unit
                PairingUi.Success -> NoticeBanner(
                    BannerKind.SUCCESS,
                    stringResource(R.string.pairing_success),
                    modifier = Modifier.testTag("pairingSuccess"),
                    action = {
                        Button(onClick = onBack, modifier = Modifier.heightIn(min = MinTouchTarget)) {
                            Text(stringResource(R.string.action_continue))
                        }
                    },
                )
                is PairingUi.Failure -> NoticeBanner(
                    BannerKind.DANGER,
                    state.message?.let { stringResource(R.string.pairing_failure, it) } ?: stringResource(R.string.pairing_failure_generic),
                    modifier = Modifier.testTag("pairingFailure"),
                )
            }

            Row(verticalAlignment = Alignment.Top) {
                Text(
                    stringResource(R.string.pairing_privacy_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
