package ai.noa.bridge.app.ui.onboarding

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.components.BulletLine
import ai.noa.bridge.app.ui.components.MinTouchTarget
import ai.noa.bridge.app.ui.components.StatusLevel
import ai.noa.bridge.app.ui.components.StatusPill
import ai.noa.bridge.app.ui.settings.ConsentDisclosureDialog
import ai.noa.bridge.app.ui.theme.NoaStatus
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

private const val PAGE_COUNT = 4

/**
 * First-run flow: what the app does, what it never does (+ the 15s wait), permissions, and the
 * cloud-consent decision. Skipping consent is allowed: the app then works but creates no drafts.
 */
@Composable
fun OnboardingScreen(
    controller: AppController,
    status: BridgeStatus,
    onRequestPostNotifications: () -> Unit,
    onFinished: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var page by rememberSaveable { mutableIntStateOf(0) }
    var showConsent by rememberSaveable { mutableStateOf(false) }

    BackHandler(enabled = page > 0) { page-- }

    Column(
        modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(horizontal = 20.dp, vertical = 12.dp)
            .testTag("onboarding"),
    ) {
        Text(
            stringResource(R.string.onb_step, page + 1, PAGE_COUNT),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.padding(top = 6.dp))
        LinearProgressIndicator(
            progress = { (page + 1) / PAGE_COUNT.toFloat() },
            modifier = Modifier.fillMaxWidth(),
            drawStopIndicator = {},
        )

        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when (page) {
                0 -> PageWhat()
                1 -> PageNever()
                2 -> PagePermissions(status, controller::openNotificationAccessSettings, onRequestPostNotifications)
                else -> PageConsent()
            }
        }

        if (page < PAGE_COUNT - 1) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (page > 0) {
                    OutlinedButton(onClick = { page-- }, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        Text(stringResource(R.string.onb_prev))
                    }
                }
                Button(
                    onClick = { page++ },
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("onboardingNext"),
                ) { Text(stringResource(R.string.onb_next)) }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { showConsent = true },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("onboardingConsent"),
                ) { Text(stringResource(R.string.onb_consent_review)) }
                TextButton(
                    onClick = onFinished,
                    modifier = Modifier.fillMaxWidth().heightIn(min = MinTouchTarget).testTag("onboardingSkip"),
                ) { Text(stringResource(R.string.onb_consent_skip)) }
                Text(
                    stringResource(R.string.onb_consent_skip_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                )
            }
        }
    }

    if (showConsent) {
        ConsentDisclosureDialog(
            onAgree = {
                showConsent = false
                controller.setCloudConsent(true)
                onFinished()
            },
            onDecline = { showConsent = false },
        )
    }
}

@Composable
private fun PageTitle(text: String) {
    Text(text, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
}

@Composable
private fun ColumnScope.PageWhat() {
    BrandMark()
    PageTitle(stringResource(R.string.onb_p1_title))
    Text(stringResource(R.string.onb_p1_body), style = MaterialTheme.typography.bodyLarge)
    BulletLine(stringResource(R.string.onb_p1_point1))
    BulletLine(stringResource(R.string.onb_p1_point2))
}

@Composable
private fun PageNever() {
    val danger = NoaStatus.colors.danger
    PageTitle(stringResource(R.string.onb_p2_title))
    BulletLine(stringResource(R.string.onb_p2_point1), icon = Icons.Filled.Clear, tint = danger)
    BulletLine(stringResource(R.string.onb_p2_point2), icon = Icons.Filled.Clear, tint = danger)
    BulletLine(stringResource(R.string.onb_p2_point3), icon = Icons.Filled.Clear, tint = danger)
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, contentColor = MaterialTheme.colorScheme.onSecondaryContainer, shape = MaterialTheme.shapes.medium) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Filled.DateRange, contentDescription = null, modifier = Modifier.size(22.dp))
            Spacer(Modifier.padding(start = 10.dp))
            Text(stringResource(R.string.onb_p2_wait), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun PagePermissions(status: BridgeStatus, onOpenAccess: () -> Unit, onRequestPostNotifications: () -> Unit) {
    PageTitle(stringResource(R.string.onb_p3_title))
    Text(stringResource(R.string.onb_p3_body), style = MaterialTheme.typography.bodyLarge)
    PermissionLine(
        title = stringResource(R.string.home_perm_notification_access),
        granted = status.notificationAccessGranted,
        onGrant = onOpenAccess,
    )
    Text(stringResource(R.string.onb_p3_post_body), style = MaterialTheme.typography.bodyMedium)
    PermissionLine(
        title = stringResource(R.string.home_perm_post_notifications),
        granted = status.postNotificationsGranted,
        onGrant = onRequestPostNotifications,
    )
}

@Composable
private fun PermissionLine(title: String, granted: Boolean, onGrant: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            StatusPill(
                level = if (granted) StatusLevel.OK else StatusLevel.PROBLEM,
                label = stringResource(if (granted) R.string.perm_granted else R.string.perm_missing),
            )
        }
        if (!granted) {
            OutlinedButton(onClick = onGrant, modifier = Modifier.heightIn(min = MinTouchTarget)) {
                Text(stringResource(R.string.action_grant))
            }
        }
    }
}

@Composable
private fun PageConsent() {
    PageTitle(stringResource(R.string.onb_p4_title))
    Text(stringResource(R.string.onb_p4_body), style = MaterialTheme.typography.bodyLarge)
}

@Composable
private fun BrandMark() {
    // Decorative brand mark (same artwork as the launcher icon).
    Surface(color = colorResource(R.color.noa_icon_background), shape = MaterialTheme.shapes.large) {
        Image(
            painter = painterResource(R.drawable.ic_launcher_foreground),
            contentDescription = null,
            modifier = Modifier.size(72.dp),
        )
    }
}
