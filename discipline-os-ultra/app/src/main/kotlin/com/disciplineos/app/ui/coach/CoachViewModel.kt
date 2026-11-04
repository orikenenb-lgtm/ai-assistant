package com.disciplineos.app.ui.coach

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.BuildConfig
import com.disciplineos.app.R
import com.disciplineos.core.domain.coach.AiCoachRepository
import com.disciplineos.core.domain.coach.CoachConversationUseCase
import com.disciplineos.core.domain.coach.CoachErrorKind
import com.disciplineos.core.domain.coach.CoachSendState
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.task.TaskError
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.model.AiPrivacySettings
import com.disciplineos.core.model.ChatMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CoachUiState(
    val loading: Boolean = true,
    val loadFailed: Boolean = false,
    val messages: List<ChatMessage> = emptyList(),
    val input: String = "",
    val sending: Boolean = false,
    /** Non-null while the reply streams in. Empty string = waiting for the first token (typing indicator). */
    val streamingText: String? = null,
    val limitReached: Boolean = false,
    @StringRes val errorRes: Int? = null,
    val isLocalProvider: Boolean = true,
    val privacy: AiPrivacySettings = AiPrivacySettings(),
    /** (messageId, actionIndex) currently being accepted/rejected — disables its buttons. */
    val pendingAction: Pair<Long, Int>? = null,
) {
    val canSend: Boolean get() = CoachInput.canSend(input, sending, limitReached)
}

private data class Transient(
    val input: String = "",
    val sending: Boolean = false,
    val streamingText: String? = null,
    val limitReached: Boolean = false,
    val errorRes: Int? = null,
    val pendingAction: Pair<Long, Int>? = null,
)

@HiltViewModel
class CoachViewModel @Inject constructor(
    private val conversation: CoachConversationUseCase,
    coachRepository: AiCoachRepository,
    settingsRepository: SettingsRepository,
) : ViewModel() {

    private val transient = MutableStateFlow(Transient())
    private var sendJob: Job? = null
    private val providerName: String = runCatching { coachRepository.providerName }.getOrDefault("")

    private sealed interface Messages {
        data object Loading : Messages
        data object Failed : Messages
        data class Ready(val list: List<ChatMessage>) : Messages
    }

    private val messages = conversation.observeMessages()
        .map<List<ChatMessage>, Messages> { Messages.Ready(it) }
        .onStart { emit(Messages.Loading) }
        .catch { emit(Messages.Failed) }

    val uiState: StateFlow<CoachUiState> = combine(
        messages,
        settingsRepository.observeAiPrivacy().catch { emit(AiPrivacySettings()) },
        transient,
    ) { m, privacy, t ->
        CoachUiState(
            loading = m is Messages.Loading,
            loadFailed = m is Messages.Failed,
            messages = (m as? Messages.Ready)?.list.orEmpty(),
            input = t.input,
            sending = t.sending,
            streamingText = t.streamingText,
            limitReached = t.limitReached,
            errorRes = t.errorRes,
            // Remote only when the provider is remote AND the user enabled it AND a backend is configured.
            isLocalProvider = CoachInput.isLocalProvider(providerName) || !privacy.remoteProviderEnabled ||
                BuildConfig.AI_BACKEND_URL.isBlank(),
            privacy = privacy,
            pendingAction = t.pendingAction,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CoachUiState())

    fun onInputChange(text: String) {
        transient.value = transient.value.copy(input = CoachInput.clamp(text))
    }

    fun sendPrompt(text: String) {
        onInputChange(text)
        send()
    }

    fun send() {
        val t = transient.value
        if (!CoachInput.canSend(t.input, t.sending, t.limitReached)) return
        val text = t.input.trim()
        transient.value = t.copy(input = "", sending = true, streamingText = "", errorRes = null)
        sendJob?.cancel()
        sendJob = viewModelScope.launch {
            try {
                conversation.send(text)
                    .catch { emit(CoachSendState.Failed(CoachErrorKind.BACKEND_UNAVAILABLE)) }
                    .collect { s -> onSendState(s) }
            } finally {
                transient.value = transient.value.copy(sending = false, streamingText = null)
            }
        }
    }

    private fun onSendState(s: CoachSendState) {
        val t = transient.value
        transient.value = when (s) {
            CoachSendState.Sending -> t.copy(sending = true, streamingText = "")
            is CoachSendState.Streaming -> t.copy(streamingText = s.partialText)
            CoachSendState.Completed -> t.copy(sending = false, streamingText = null)
            is CoachSendState.Failed -> t.copy(sending = false, streamingText = null, errorRes = errorFor(s.kind))
            CoachSendState.LimitReached -> t.copy(sending = false, streamingText = null, limitReached = true)
        }
    }

    fun stopStreaming() {
        sendJob?.cancel()
    }

    fun dismissError() {
        transient.value = transient.value.copy(errorRes = null)
    }

    fun acceptAction(messageId: Long, index: Int) = actOn(messageId, index) {
        when (val r = conversation.acceptAction(messageId, index)) {
            is TaskResult.Success -> null
            is TaskResult.Failure -> taskErrorFor(r.error)
        }
    }

    fun rejectAction(messageId: Long, index: Int) = actOn(messageId, index) {
        conversation.rejectAction(messageId, index)
        null
    }

    fun clearHistory() {
        viewModelScope.launch {
            sendJob?.cancel()
            runCatching { conversation.clearHistory() }
                .onFailure { transient.value = transient.value.copy(errorRes = R.string.feat_coach_error_generic) }
        }
    }

    private fun actOn(messageId: Long, index: Int, block: suspend () -> Int?) {
        if (transient.value.pendingAction != null) return
        transient.value = transient.value.copy(pendingAction = messageId to index)
        viewModelScope.launch {
            val error = runCatching { block() }.getOrElse { R.string.feat_coach_error_action }
            transient.value = transient.value.copy(pendingAction = null, errorRes = error ?: transient.value.errorRes)
        }
    }

    private fun errorFor(kind: CoachErrorKind): Int = when (kind) {
        CoachErrorKind.OFFLINE -> R.string.feat_coach_error_offline
        CoachErrorKind.RATE_LIMITED -> R.string.feat_coach_error_rate_limited
        CoachErrorKind.QUOTA_EXCEEDED -> R.string.feat_coach_error_quota
        CoachErrorKind.BACKEND_UNAVAILABLE -> R.string.feat_coach_error_backend
        CoachErrorKind.INVALID_RESPONSE -> R.string.feat_coach_error_invalid
        CoachErrorKind.NOT_CONFIGURED -> R.string.feat_coach_error_not_configured
    }

    private fun taskErrorFor(error: TaskError): Int = when (error) {
        TaskError.TITLE_BLANK, TaskError.TITLE_TOO_LONG -> R.string.feat_coach_action_error_title
        TaskError.NOT_FOUND -> R.string.feat_coach_action_error_not_found
        TaskError.ALREADY_RESOLVED -> R.string.feat_coach_action_error_resolved
        else -> R.string.feat_coach_error_action
    }
}
