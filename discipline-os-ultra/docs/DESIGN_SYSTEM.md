# Design System — חוזה רכיבים

Package: `com.disciplineos.app.designsystem`. Tokens: `designsystem/theme/Tokens.kt` (Palette, DisciplineColors, Spacing, Shapes, Motion).

## Theme
```kotlin
@Composable fun DisciplineTheme(highContrast: Boolean = false, reduceMotion: Boolean = false, content: @Composable () -> Unit)
object DisciplineTheme {
    val colors: DisciplineColors      @Composable get
    val spacing: DisciplineSpacing    @Composable get
    val shapes: DisciplineShapes      @Composable get
    val motion: DisciplineMotion      @Composable get
    val typography: androidx.compose.material3.Typography @Composable get
}
```
`DisciplineTheme` also sets a dark Material3 `ColorScheme` mapped from the palette, so plain M3 components look on-brand.
Typography scales with the system font size (sp everywhere; no fixed heights on text containers → Dynamic Type safe).

## Components (`designsystem.component`) — exact signatures
```kotlin
@Composable fun DsCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, contentPadding: PaddingValues = PaddingValues(16.dp), content: @Composable ColumnScope.() -> Unit)
@Composable fun DsPrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false, icon: ImageVector? = null)
@Composable fun DsSecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null)
@Composable fun DsDangerButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true)
@Composable fun DsProgressRing(progress: Float, modifier: Modifier = Modifier, size: Dp = 120.dp, stroke: Dp = 12.dp, color: Color = DisciplineTheme.colors.primary, trackColor: Color = DisciplineTheme.colors.surfaceSunken, content: @Composable () -> Unit = {})
@Composable fun DsLinearProgress(progress: Float, modifier: Modifier = Modifier, color: Color = DisciplineTheme.colors.primary)
@Composable fun DsSectionHeader(title: String, modifier: Modifier = Modifier, actionLabel: String? = null, onAction: (() -> Unit)? = null)
@Composable fun DsEmptyState(title: String, message: String, icon: ImageVector, modifier: Modifier = Modifier, actionLabel: String? = null, onAction: (() -> Unit)? = null)
@Composable fun DsLoadingState(modifier: Modifier = Modifier, message: String? = null)
@Composable fun DsErrorState(message: String, modifier: Modifier = Modifier, onRetry: (() -> Unit)? = null)
@Composable fun DsChip(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, leadingIcon: ImageVector? = null)
@Composable fun DsBadge(text: String, color: Color, modifier: Modifier = Modifier)
@Composable fun DsStatTile(label: String, value: String, modifier: Modifier = Modifier, icon: ImageVector? = null, accent: Color = DisciplineTheme.colors.primary, caption: String? = null)
@Composable fun DsTopBar(title: String, modifier: Modifier = Modifier, onBack: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {})
@Composable fun DsSwitchRow(title: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, subtitle: String? = null, enabled: Boolean = true)
@Composable fun DsListRow(title: String, modifier: Modifier = Modifier, subtitle: String? = null, leadingIcon: ImageVector? = null, trailing: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null)
@Composable fun DsTextField(value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, singleLine: Boolean = true, maxLength: Int? = null, isError: Boolean = false, supportingText: String? = null)
@Composable fun DsConfirmDialog(title: String, message: String, confirmLabel: String, dismissLabel: String, onConfirm: () -> Unit, onDismiss: () -> Unit, destructive: Boolean = false)
```

## Common UI state (`ui.common`)
```kotlin
sealed interface UiState<out T> { data object Loading; data class Success<T>(val data: T); data class Error(val message: String); data object Empty }
```

## כללי נגישות ו-RTL
- כל רכיב לחיץ ≥ 48dp, עם `contentDescription`/`semantics` בעברית.
- שימוש ב-`start/end` בלבד (לא left/right); אייקוני כיוון (חצים) עם `autoMirror`.
- אנימציות מכבדות `DisciplineTheme.motion.reduceMotion`.
- ניגודיות טקסט ≥ 4.5:1 (מצב High Contrast ≥ 7:1).
