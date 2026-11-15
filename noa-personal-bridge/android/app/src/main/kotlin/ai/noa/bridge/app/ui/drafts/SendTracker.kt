package ai.noa.bridge.app.ui.drafts

import ai.noa.bridge.app.AppController
import ai.noa.bridge.core.Approval
import ai.noa.bridge.core.DraftState
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the UI knows about the single send attempt of one draft. */
sealed interface SendUiState {
    data object InFlight : SendUiState
    data class Finished(val result: DraftState) : SendUiState
    /** sendApproved threw: we do not know whether anything was sent. */
    data object Crashed : SendUiState
}

/**
 * Holds send attempts outside of any single screen so that leaving the draft screen, rotating the
 * device or recomposing can never cancel an attempt half-way or start a second one. A draft id that
 * has been attempted once is never attempted again from the UI.
 */
class SendTracker : ViewModel() {
    private val lock = Any()
    private val _attempts = MutableStateFlow<Map<String, SendUiState>>(emptyMap())
    val attempts: StateFlow<Map<String, SendUiState>> = _attempts.asStateFlow()

    /** Returns false (and does nothing) if this draft was already attempted. */
    fun send(controller: AppController, approval: Approval): Boolean {
        synchronized(lock) {
            if (approval.draftId in _attempts.value) return false
            _attempts.value = _attempts.value + (approval.draftId to SendUiState.InFlight)
        }
        viewModelScope.launch {
            val outcome: SendUiState = try {
                SendUiState.Finished(controller.sendApproved(approval))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                SendUiState.Crashed
            }
            synchronized(lock) { _attempts.value = _attempts.value + (approval.draftId to outcome) }
        }
        return true
    }
}
