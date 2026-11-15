package ai.noa.bridge.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

enum class Tab { HOME, DRAFTS, SETTINGS }

/** Full-screen destinations shown above the tabs. */
sealed interface Overlay {
    data class DraftDetail(val draftId: String) : Overlay
    data object Pairing : Overlay
}

/**
 * Minimal state-based navigation (no navigation library): one selected tab plus a stack of
 * full-screen overlays. Survives configuration changes and process death via [Saver].
 */
@Stable
class NavState(initialTab: Tab = Tab.HOME, initialStack: List<Overlay> = emptyList()) {
    var tab by mutableStateOf(initialTab)
    private val stack = mutableStateListOf<Overlay>().apply { addAll(initialStack) }

    val top: Overlay? get() = stack.lastOrNull()
    val hasOverlay: Boolean get() = stack.isNotEmpty()

    fun select(tab: Tab) {
        stack.clear()
        this.tab = tab
    }

    fun push(overlay: Overlay) {
        if (stack.lastOrNull() != overlay) stack.add(overlay)
    }

    /** Returns true if something was popped. */
    fun pop(): Boolean = if (stack.isNotEmpty()) { stack.removeAt(stack.lastIndex); true } else false

    companion object {
        val Saver: Saver<NavState, List<String>> = Saver(
            save = { nav ->
                listOf(nav.tab.name) + nav.stack.map {
                    when (it) {
                        is Overlay.DraftDetail -> "d:${it.draftId}"
                        Overlay.Pairing -> "p"
                    }
                }
            },
            restore = { saved ->
                val tab = saved.firstOrNull()?.let { name -> Tab.entries.firstOrNull { it.name == name } } ?: Tab.HOME
                val stack = saved.drop(1).mapNotNull {
                    when {
                        it == "p" -> Overlay.Pairing
                        it.startsWith("d:") -> Overlay.DraftDetail(it.removePrefix("d:"))
                        else -> null
                    }
                }
                NavState(tab, stack)
            },
        )
    }
}

@Composable
fun rememberNavState(): NavState = rememberSaveable(saver = NavState.Saver) { NavState() }
