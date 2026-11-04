package com.disciplineos.app.ui.common

/** Shared screen state. [Error.message] is a user-facing (Hebrew) message when produced by a screen. */
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Success<T>(val data: T) : UiState<T>
    data class Error(val message: String) : UiState<Nothing>
    data object Empty : UiState<Nothing>
}

/** The data when this state is [UiState.Success], otherwise null. */
fun <T> UiState<T>.dataOrNull(): T? = (this as? UiState.Success<T>)?.data
