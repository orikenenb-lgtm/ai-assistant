package ai.noa.bridge.app.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/*
 * NOA palette: deep indigo primary on warm neutrals. No dynamic color — the app must look the same
 * on every device. Every foreground/background pair below was chosen for WCAG AA (>= 4.5:1 for
 * text, >= 3:1 for large text and UI outlines).
 */

// Brand
internal val Indigo10 = Color(0xFF130A5C)
internal val Indigo20 = Color(0xFF24178F)
internal val Indigo30 = Color(0xFF3A2FB0)
internal val Indigo40 = Color(0xFF4B3FD1) // primary
internal val Indigo80 = Color(0xFFC5BFFF)
internal val Indigo90 = Color(0xFFE5E1FF)

// Warm neutrals (light)
private val WarmBg = Color(0xFFFAF8F5)
private val WarmLowest = Color(0xFFFFFFFF)
private val WarmLow = Color(0xFFF5F2EE)
private val WarmMid = Color(0xFFF0ECE7)
private val WarmHigh = Color(0xFFEAE5DF)
private val WarmHighest = Color(0xFFE4DED7)
private val WarmInk = Color(0xFF1D1B19)
private val WarmInkVariant = Color(0xFF4A4540)
private val WarmOutline = Color(0xFF7A736C)
private val WarmOutlineVariant = Color(0xFFD2CBC3)

// Warm neutrals (dark)
private val NightBg = Color(0xFF151412)
private val NightLowest = Color(0xFF100F0D)
private val NightLow = Color(0xFF1D1C19)
private val NightMid = Color(0xFF22201E)
private val NightHigh = Color(0xFF2C2A27)
private val NightHighest = Color(0xFF373532)
private val NightInk = Color(0xFFE9E4DE)
private val NightInkVariant = Color(0xFFCFC7BE)
private val NightOutline = Color(0xFF9A9289)
private val NightOutlineVariant = Color(0xFF4B4641)

internal val NoaLightColors = lightColorScheme(
    primary = Indigo40,
    onPrimary = Color.White,
    primaryContainer = Indigo90,
    onPrimaryContainer = Indigo10,
    inversePrimary = Indigo80,
    secondary = Color(0xFF5F5A72),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE6E0F5),
    onSecondaryContainer = Color(0xFF1C182B),
    tertiary = Color(0xFF7A4E2D),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFFDCC4),
    onTertiaryContainer = Color(0xFF2E1504),
    background = WarmBg,
    onBackground = WarmInk,
    surface = WarmBg,
    onSurface = WarmInk,
    surfaceVariant = WarmHigh,
    onSurfaceVariant = WarmInkVariant,
    surfaceTint = Indigo40,
    surfaceBright = WarmBg,
    surfaceDim = Color(0xFFDDD8D1),
    surfaceContainerLowest = WarmLowest,
    surfaceContainerLow = WarmLow,
    surfaceContainer = WarmMid,
    surfaceContainerHigh = WarmHigh,
    surfaceContainerHighest = WarmHighest,
    inverseSurface = Color(0xFF32302D),
    inverseOnSurface = Color(0xFFF5F0EA),
    error = Color(0xFFB3261E),
    onError = Color.White,
    errorContainer = Color(0xFFF9DEDC),
    onErrorContainer = Color(0xFF410E0B),
    outline = WarmOutline,
    outlineVariant = WarmOutlineVariant,
    scrim = Color.Black,
)

internal val NoaDarkColors = darkColorScheme(
    primary = Indigo80,
    onPrimary = Indigo20,
    primaryContainer = Indigo30,
    onPrimaryContainer = Indigo90,
    inversePrimary = Indigo40,
    secondary = Color(0xFFCAC3DC),
    onSecondary = Color(0xFF322D41),
    secondaryContainer = Color(0xFF484359),
    onSecondaryContainer = Color(0xFFE6E0F5),
    tertiary = Color(0xFFF0BC95),
    onTertiary = Color(0xFF472A12),
    tertiaryContainer = Color(0xFF603F25),
    onTertiaryContainer = Color(0xFFFFDCC4),
    background = NightBg,
    onBackground = NightInk,
    surface = NightBg,
    onSurface = NightInk,
    surfaceVariant = NightHigh,
    onSurfaceVariant = NightInkVariant,
    surfaceTint = Indigo80,
    surfaceBright = Color(0xFF3B3936),
    surfaceDim = NightBg,
    surfaceContainerLowest = NightLowest,
    surfaceContainerLow = NightLow,
    surfaceContainer = NightMid,
    surfaceContainerHigh = NightHigh,
    surfaceContainerHighest = NightHighest,
    inverseSurface = NightInk,
    inverseOnSurface = Color(0xFF32302D),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = NightOutline,
    outlineVariant = NightOutlineVariant,
    scrim = Color.Black,
)

/** Semantic status colors that Material 3 does not provide. Never used as the only signal. */
@Immutable
data class StatusColors(
    val success: Color,
    val onSuccess: Color,
    val successContainer: Color,
    val onSuccessContainer: Color,
    val warning: Color,
    val onWarning: Color,
    val warningContainer: Color,
    val onWarningContainer: Color,
    val danger: Color,
    val onDanger: Color,
    val dangerContainer: Color,
    val onDangerContainer: Color,
    val info: Color,
    val infoContainer: Color,
    val onInfoContainer: Color,
)

internal val LightStatusColors = StatusColors(
    success = Color(0xFF1E6B3A),
    onSuccess = Color.White,
    successContainer = Color(0xFFD6EFDC),
    onSuccessContainer = Color(0xFF0A3A1B),
    warning = Color(0xFF875200),
    onWarning = Color.White,
    warningContainer = Color(0xFFFFE6C2),
    onWarningContainer = Color(0xFF452900),
    danger = Color(0xFFB3261E),
    onDanger = Color.White,
    dangerContainer = Color(0xFFFBE0DD),
    onDangerContainer = Color(0xFF5A0B06),
    info = Indigo40,
    infoContainer = Indigo90,
    onInfoContainer = Indigo10,
)

internal val DarkStatusColors = StatusColors(
    success = Color(0xFF8FD8A3),
    onSuccess = Color(0xFF00391A),
    successContainer = Color(0xFF124D29),
    onSuccessContainer = Color(0xFFC4F1CF),
    warning = Color(0xFFFFC06B),
    onWarning = Color(0xFF452900),
    warningContainer = Color(0xFF5C3A00),
    onWarningContainer = Color(0xFFFFE1BA),
    danger = Color(0xFFFFB4AB),
    onDanger = Color(0xFF690005),
    dangerContainer = Color(0xFF8C1D18),
    onDangerContainer = Color(0xFFFFDAD6),
    info = Indigo80,
    infoContainer = Indigo30,
    onInfoContainer = Indigo90,
)

val LocalStatusColors = staticCompositionLocalOf { LightStatusColors }
