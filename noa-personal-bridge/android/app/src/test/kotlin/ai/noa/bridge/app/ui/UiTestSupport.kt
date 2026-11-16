package ai.noa.bridge.app.ui

import ai.noa.bridge.app.ui.theme.NoaTheme
import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.test.core.app.ApplicationProvider

/** Theme + RTL wrapper used when a test renders a single screen (NoaApp provides RTL itself). */
@Composable
fun TestFrame(content: @Composable () -> Unit) {
    NoaTheme(darkTheme = false) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl, content = content)
    }
}

fun str(@StringRes id: Int, vararg args: Any): String =
    ApplicationProvider.getApplicationContext<Context>().getString(id, *args)
