# תוכנית בדיקות — NOA Personal Bridge

**צוות QA:** Agent 27 (QA Automation Lead) · Agent 28 (Android Test Engineer) · Agent 29 (Regression Testing Engineer)
**תאריך:** 2026-11-15 · **ענף:** `claude/serene-planck-84hxxm`
**תוצאות ההרצה:** [TEST_RESULTS.md](TEST_RESULTS.md) · **בסיס רגרסיה:** [BASELINE_REGRESSION.md](BASELINE_REGRESSION.md) · **בדיקות מכשיר:** [ANDROID_FEASIBILITY.md](ANDROID_FEASIBILITY.md) §5 (R0–R16, S1–S3)

---

## 1. מטרה

1. למפות **כל** תרחיש בדיקה שבמפרט (13.1–13.4) לבדיקה אוטומטית אמיתית, או לסמן במפורש שהוא דורש מכשיר (`DEVICE_ONLY`) או שאינו מכוסה (`NOT_COVERED`), עם סיבה.
2. להשלים פערים בבדיקות חדשות, בלי לגעת בקוד או בבדיקות קיימים.
3. להוכיח שהמערכות הקיימות (backend, frontend, smart-crm) לא נשברו.

כלל הזהב בכל בדיקה בתחום 13.1–13.2: **הטענה האחרונה היא תמיד כמה פעמים נקרא ה-`ReplySender` (או כמה broadcasts הגיעו ל-PendingIntent של WhatsApp), לאיזו שיחה ועם איזה טקסט בדיוק.**

## 2. אסטרטגיה ורמות

| רמה | מה נבדק | איפה רץ | זמן | כפילים (fakes) |
|---|---|---|---|---|
| **L1 — יחידה (Domain)** | `core`: סינון, Dedup, Debounce, State Machine, ApprovalGuard, `BridgeCoordinator`. Python: `safety`, `prompt`, `output_guard`, `stub` | JVM / pytest | שניות | שעון וירטואלי (`TestScope`), מנוע ו-Sender מקליטים |
| **L2 — רכיב/אינטגרציה** | `app/platform` עם Robolectric: `NotificationMapper` → `NotificationIngestor` → `DefaultAppController` → `BridgeCoordinator` → `RemoteInputReplySender` → `PendingIntent.send`. שרת: FastAPI `TestClient` עם auth/replay/idempotency אמיתיים | Robolectric SDK 35 / TestClient | שניות | רק מנוע הטיוטות; רשימת ההתראות ה"חיות" של ה-Listener מדומה |
| **L3 — מקצה לקצה על המחשב** | התראה אמיתית (`NotificationCompat` + MessagingStyle + RemoteInput) עד broadcast ל-PendingIntent; `NoaNotificationListenerService` אמיתי בתוך `BridgeApplication` אמיתי; `BridgeApiClient` (OkHttp) מול loopback (פורט סגור / MockWebServer) | Robolectric | שניות | אין רשת חיצונית, אין מודל |
| **L4 — מכשיר** | Galaxy S25 Ultra אמיתי, WhatsApp אמיתי, One UI | ידני, לפי R0–R16 ו-S1–S3 | שעות | — |
| **רגרסיה** | backend pytest, frontend lint+build, smart-crm (i18n, db bundle, typecheck, lint, unit, build) | עותק `git archive` בתיקיית scratch | ~2 דק' | — |

**למה כך:** כל כללי הבטיחות יושבים ב-`core` (Kotlin טהור), ולכן רוב התרחישים נבדקים שם מהר ודטרמיניסטית בזמן וירטואלי (15 שניות debounce, 45 שניות timeout, 2 דקות לאישור — בלי לחכות באמת). בשכבת ה-platform בודקים את מה שה-core לא יכול לראות: מיפוי התראה אמיתית, שמירת Reply handle, PendingIntent אמיתי, מצב Listener, נעילת מסך ורשת. מה שתלוי במערכת ההפעלה האמיתית (One UI, חיסכון בסוללה, WhatsApp עצמו) מסומן `DEVICE_ONLY`.

## 3. כלים

| תחום | כלים |
|---|---|
| Android core | JUnit 4.13.2, kotlinx-coroutines-test 1.10.2 (`runTest`, `advanceTimeBy`, `backgroundScope`) |
| Android app | Robolectric 4.16.1 (`@Config(sdk = [35])`), `ShadowNotificationListenerService`, OkHttp MockWebServer 4.12.0, androidx.test core |
| Android build | Gradle wrapper, AGP 8.13.2, Kotlin 2.2.21, `:app:lintDebug`, `:app:assembleDebug` |
| Python | pytest 8.3.5, pytest-asyncio 0.26.0 (`asyncio_mode=auto`), respx 0.22.0 (mock ל-Anthropic API עם מפתח מזויף), FastAPI TestClient |
| רגרסיה | Python 3.11.18 (כמו ב-CI), Node v22.23.4 / npm 10.9.9 |
| ספירת תוצאות | קבצי JUnit XML (`core/build/test-results/test`, `app/build/test-results/testDebugUnitTest`), `--junitxml` ל-pytest |

## 4. כללי עבודה

- **אין רשת אמיתית, אין API בתשלום, אין שליחה ליעד אמיתי.** Anthropic רק דרך respx עם `qa-fake-key-not-real`; HTTP של האפליקציה רק ל-`127.0.0.1`; "שליחה" = broadcast מוקלט של Robolectric.
- **קבצים חדשים בלבד:** `core/src/test/.../core/qa/*.kt`, `app/src/test/.../app/qa/*.kt`, `bridge-service/tests/test_qa_*.py`. אף קובץ קוד או בדיקה קיים לא שונה.
- **באג שנמצא נשאר כבדיקה:** Kotlin `@Ignore("BUG: <id> — ...")`, Python `pytest.mark.xfail(strict=True, reason="BUG: <id> — ...")`. `strict=True` מבטיח שהבדיקה תיכשל ברגע שהבאג יתוקן, כדי להסיר את הסימון.
- **שמות בדיקה = שם התרחיש:** `scenario_*` / `approval_*` (core), `e2e_*` / `service_*` / `noInternet_*` / `content_*` (app), `test_<scenario>_*` / `test_api_*` (Python).

### קבצי הבדיקות החדשים (קיצורים במטריצה)

| קיצור | קובץ | בדיקות |
|---|---|---|
| **C-FLOW** | `noa-personal-bridge/android/core/src/test/kotlin/ai/noa/bridge/core/qa/AndroidFlowScenariosQaTest.kt` | 24 |
| **C-APPR** | `noa-personal-bridge/android/core/src/test/kotlin/ai/noa/bridge/core/qa/ApprovalSafetyScenariosQaTest.kt` | 21 |
| (עזר) | `noa-personal-bridge/android/core/src/test/kotlin/ai/noa/bridge/core/qa/QaHarness.kt` | — |
| **A-E2E** | `noa-personal-bridge/android/app/src/test/kotlin/ai/noa/bridge/app/qa/EndToEndPipelineQaTest.kt` | 23 |
| **A-SVC** | `noa-personal-bridge/android/app/src/test/kotlin/ai/noa/bridge/app/qa/ListenerServiceQaTest.kt` | 4 |
| **A-NET** | `noa-personal-bridge/android/app/src/test/kotlin/ai/noa/bridge/app/qa/NoInternetQaTest.kt` | 3 |
| **A-MSG** | `noa-personal-bridge/android/app/src/test/kotlin/ai/noa/bridge/app/qa/MessageContentQaTest.kt` | 4 (1 `@Ignore` = באג QA-03) |
| (עזר) | `noa-personal-bridge/android/app/src/test/kotlin/ai/noa/bridge/app/qa/QaAppSupport.kt` | — |
| **P-AI** | `noa-personal-bridge/bridge-service/tests/test_qa_ai_scenarios.py` | 112 (5 xfail = באגים QA-01, QA-02) |
| **P-API** | `noa-personal-bridge/bridge-service/tests/test_qa_api_scenarios.py` | 19 |

בדיקות קיימות של צוותי הפיתוח שמכסות גם הן תרחישים מופיעות במטריצה בשמן המלא (למשל `BridgeCoordinatorTest::sendExactlyOnceUnderConcurrency`).

---

## 5. מטריצת עקיבות

סטטוסים: **AUTOMATED** — מכוסה בבדיקה אוטומטית שעוברת · **AUTOMATED (BUG)** — מכוסה, ונמצא באג (בדיקה מסומנת) · **DEVICE_ONLY** — תלוי במכשיר/מערכת הפעלה/WhatsApp אמיתיים · **NOT_COVERED** — לא מכוסה, עם סיבה.
הרבה תרחישים הם `AUTOMATED` + חלק `DEVICE_ONLY`: האוטומציה מוכיחה את הלוגיקה שלנו, והמכשיר את ההתנהגות של WhatsApp ו-One UI.

### 13.1 — Android

| # | תרחיש | בדיקות (קובץ::שם) | סטטוס | הערות / מה נשאר למכשיר |
|---|---|---|---|---|
| 1 | הודעה בודדת | C-FLOW::`scenario_singleMessage_oneDraftOneRequestNothingSent` · A-E2E::`e2e_singleMessage_replyGoesThroughWhatsAppReplyActionExactlyOnceAfterApproval` · `BridgeCoordinatorTest::happyPathToSendAttempted` | AUTOMATED + DEVICE_ONLY | מכשיר: R2, S1 (הודעה מגיעה בפועל ל-WhatsApp) |
| 2 | כמה הודעות ברצף | C-FLOW::`scenario_consecutiveMessages_batchedIntoOneRequest_timerRestartsOnEach` · A-E2E::`e2e_consecutiveMessages_oneDraft_latestReplyHandleIsUsed` · `ConversationDebouncerTest::consecutiveMessagesResetTimer` | AUTOMATED + DEVICE_ONLY | מכשיר: R6 (WhatsApp מעדכן התראה אחת 5 פעמים) |
| 3 | שתי שיחות במקביל | C-FLOW::`scenario_twoConversationsInParallel_independentTimersDraftsAndSends`, `scenario_parallel_interleavedBurstsNeverLeakAcrossConversations` · A-E2E::`e2e_twoConversations_replyReachesOnlyTheApprovedChat` · `BridgeCoordinatorTest::twoConversationsAreIndependent` | AUTOMATED + DEVICE_ONLY | מכשיר: R4 (יציבות `ConversationKey` מול WhatsApp אמיתי) |
| 4 | הודעה בקבוצה | C-FLOW::`scenario_groupMessage_neverDraftedNeverReachesEngine_inAnyShape`, `scenario_groupMessage_doesNotDisturbAnActivePrivateDraft` · A-E2E::`e2e_groupMessage_noDraftNoReplyHandleNoEngineCall` · A-SVC::`service_ignoresOtherAppsOtherUsersAndGroupChats` · `ConversationFilterTest::*group*` | AUTOMATED + DEVICE_ONLY | 6 צורות של קבוצה כולל "לא ודאי" (fail-closed). מכשיר: R11 (קבוצה/ערוץ/סטטוס/קהילה) |
| 5 | שיחה מוחרגת | C-FLOW::`scenario_excludedConversation_ignoredWhileOthersContinue`, `scenario_excludingMidFlight_expiresDraftAndVoidsItsApproval` · A-E2E::`e2e_excludedConversation_draftExpired_handleDropped_futureMessagesIgnored` · `DefaultAppControllerTest::excludeConversationStoresEncryptedEntryAndCancelsItsDrafts` | AUTOMATED | — |
| 6 | התראה חסרה | C-FLOW::`scenario_missingNotification_lostUpdateIsRecoveredFromHistory`, `scenario_missingNotification_hiddenOrRedactedContentNeverDrafted` · A-E2E::`e2e_hiddenOrRedactedNotification_noDraftNoHandleEvenWithReplyAction`, `e2e_notificationWithoutReplyAction_draftShownButSendFailsClosed` | AUTOMATED + DEVICE_ONLY | כולל הסתרת תוכן רגיש של Android 15. מכשיר: R3, R8, R10 (מושתק/ארכיון), R13 (DND), Chat Lock |
| 7 | התראה שהוסרה | C-FLOW::`scenario_removedNotification_expiresDraftInEveryActiveState_andNothingIsSent` · A-E2E::`e2e_removedBecauseUserOpenedChat_draftExpired_nothingSent`, `e2e_removedByTimeout_draftKept_butSendFailsClosedWithoutHandle` · A-SVC::`service_postedPrivateMessage_reachesCoordinator_andUserOpeningChatExpiresIt` | AUTOMATED + DEVICE_ONLY | מכשיר: R7 (איזה `reason` WhatsApp שולח בפועל), S3 |
| 8 | התראה שהשתנתה/עודכנה | C-FLOW::`scenario_updatedNotification_identicalRepostIsDedupedAndDoesNotResetTimer`, `scenario_updatedNotification_newLineWhileAwaiting_rebuildsDraftAndVoidsApproval`, `scenario_updatedNotification_userRepliedManually_expiresDraft` · A-E2E::`e2e_updatedNotification_newLineVoidsApproval_newHandleAndNewTextUsed`, `e2e_updatedNotificationAfterManualReply_expiresDraft`, `e2e_notificationSlotReusedByAnotherChat_neverRepliesIntoTheWrongConversation` | AUTOMATED + DEVICE_ONLY | מכשיר: R15 (מחיקה לכולם / עריכת הודעה) |
| 9 | הרשאה בוטלה (Listener מנותק) | A-SVC::`service_rebuiltHandle_isUsableWhileConnected_andRefusedAfterAccessRevoked` · A-E2E::`e2e_listenerDisconnected_sendFailsClosed_noBroadcast`, `e2e_permissionRevoked_statusShowsDisconnected_andProductionSenderRefuses` · `RemoteInputReplySenderTest::listenerDisconnectedMeansFailedNoAction` · `DefaultAppControllerTest::refreshPermissionsReportsMissingAccess` | AUTOMATED + DEVICE_ONLY | כולל `requestRebind` אחרי ניתוק. מכשיר: R1, ביטול גישה בפועל ב-Settings, R16 (אחרי עדכון One UI) |
| 10 | מסך נעול | A-E2E::`e2e_screenLocked_draftPreparedButSendRefusedUntilUnlock_thenExactlyOnce` · `DefaultAppControllerTest::sendRefusedWhileDeviceLocked` | AUTOMATED + DEVICE_ONLY | הנעילה מוזרקת (`isDeviceLocked`). מכשיר: R9 (`KeyguardManager.isDeviceLocked` אמיתי, תוכן במסך נעילה) |
| 11 | ריסטארט (מוות תהליך) | C-FLOW::`scenario_restart_newProcessHasNoDraftsAndRejectsOldApprovals` · A-E2E::`e2e_restart_draftsGone_settingsKept_handlesRebuilt_noDraftsForOldMessages`, `e2e_emergencyStop_dropsHandles_voidsApprovals_andSurvivesRestart` · A-SVC::`service_onListenerConnected_rebuildsReplyHandlesFromActiveNotifications_withoutDrafts` · `DefaultAppControllerTest::settingsSurviveRestart` | AUTOMATED + DEVICE_ONLY | טיוטות נמחקות; handles נבנים מחדש מההתראות הפעילות; הודעות ישנות לא יוצרות טיוטות. מכשיר: R14 (החלקה מ-Recents, אתחול, Force stop) |
| 12 | חיסכון בסוללה | — | **DEVICE_ONLY** | אין דרך אמינה לדמות את Doze / "Sleeping apps" / Adaptive battery של Samsung ב-Robolectric. מכשיר: R14(א), רשימת הגדרות Samsung ב-ANDROID_FEASIBILITY §6 |
| 13 | קריסת אפליקציה | C-FLOW::`scenario_crash_engineThrows_draftFailedNoRetry_otherConversationUnaffected`, `scenario_crash_senderThrows_unknownResult_neverRetried` · A-E2E::`e2e_crash_engineThrows_draftFailed_appKeepsWorkingForOtherChats` · A-NET::`serverCrash_502AndGarbageBody_failedWithoutRetry_thenRecoversOnNextMessage` · `BridgeCoordinatorTest::senderExceptionIsUnknownResult` · `ConversationDebouncerTest::throwingCallbackDoesNotBreakOtherKeys` | AUTOMATED + DEVICE_ONLY | קריסת רכיב → מצב בטוח בלי Retry; קריסת תהליך = תרחיש 11. מכשיר: קריסה אמיתית (חריגה לא נתפסת שמפילה את התהליך) וחזרה |
| 14 | אין אינטרנט | A-NET::`noInternet_connectionRefused_failedOnce_noRetry_statusUnreachable`, `noInternet_connectionDropsMidRequest_noSilentOkHttpRetry` · C-FLOW::`scenario_noInternet_engineUnavailable_failedAndNeverAutoRetried_thenRecovers`, `scenario_noInternet_engineHangs_failsAfter45sTimeout` · `BridgeApiClientTest::ioErrorIsRetryableUnavailable` | AUTOMATED + DEVICE_ONLY | מכשיר: מצב טיסה / Wi-Fi כבוי. שימו לב: אין רשת → גם WhatsApp לא ישלח; `ATTEMPTED` אינו "נמסר" |
| 15 | Debounce של 15 שניות | C-FLOW::`scenario_debounce_defaultIsExactly15Seconds`, `scenario_debounce_messageAt14999RestartsTheFullWindow`, `scenario_debounce_pausingInsideTheWindowNeverCallsTheEngine`, `scenario_debounce_withoutCloudConsentNothingLeavesTheDevice` · A-E2E::`e2e_debounce_is15sFromBuildConfig_andCannotBeOverriddenByStoredSettings` · `ConversationDebouncerTest::singleMessageFiresAfterExactlyDelay` | AUTOMATED + DEVICE_ONLY | גבול מדויק: 14,999 ms — ממתין, 15,000 ms — נשלח. מכשיר: R6 (שעון אמיתי, Doze) |

### 13.2 — אישור

| # | תרחיש | בדיקות (קובץ::שם) | סטטוס | הערות |
|---|---|---|---|---|
| 1 | אין שליחה בלי אישור | C-APPR::`approval_noApproval_nothingIsEverSent`, `approval_forgedOrTamperedApprovalNeverSends`, `approval_cannotApproveBeforeTheDraftIsShown` · A-E2E::`e2e_noApproval_noSend_evenWithEverythingEnabled`, `e2e_sendingToggleOff_approvedDraftIsNotSent` · `BridgeCoordinatorTest::nothingIsSentWithoutApproval` · `DraftStateMachineTest::onlyApprovedLeadsToSending` | AUTOMATED | 24 שעות וירטואליות בלי פעולה = 0 שליחות; טוקן מזויף/מוארך נדחה ונשרף |
| 2 | ביטול לא שולח | C-APPR::`approval_cancelInEveryCancellableStateSendsNothing`, `approval_cancelWhileSendingCannotStopOrDuplicateTheSingleAttempt` · A-E2E::`e2e_cancel_sendsNothing` · `BridgeCoordinatorTest::cancelNeverSends` | AUTOMATED | — |
| 3 | עריכה מחייבת אישור | C-APPR::`approval_editRequiresFreshApproval_andExactlyTheEditedTextIsSent`, `approval_onlyTheExactDisplayedTextCanBeApproved`, `approval_editWithBlankOrOversizedTextIsIgnored` · A-E2E::`e2e_edit_requiresNewApproval_andWhatsAppReceivesExactlyTheEditedText` · `BridgeCoordinatorTest::editInvalidatesApprovalAndRequiresReapproval` | AUTOMATED | WhatsApp מקבל בדיוק את הטקסט הערוך (כולל שורה חדשה ואימוג'י) |
| 4 | אישור ישן לא תקף | C-APPR::`approval_ttlBoundary_validUntil119999ms_invalidAt120000ms`, `approval_reApprovalIssuesNewToken_oldTokenNeverWorks`, `approval_pauseOrEmergencyStopVoidsOutstandingApprovals` · C-FLOW::`scenario_restart_newProcessHasNoDraftsAndRejectsOldApprovals` · `ApprovalGuardTest::expiredRejected` | AUTOMATED | גבול TTL מדויק: 119,999 ms תקף, 120,000 ms לא |
| 5 | הודעה חדשה מבטלת טיוטה ישנה | C-APPR::`approval_newMessageWhileApproved_cancelsDraftAndApproval_oldTextNeverSent`, `approval_newMessageWhileEngineRunning_lateResultIsDiscarded` · A-E2E::`e2e_updatedNotification_newLineVoidsApproval_newHandleAndNewTextUsed` · `BridgeCoordinatorTest::newMessageWhileApprovedInvalidatesApproval` | AUTOMATED | — |
| 6 | אין שליחה כפולה | C-APPR::`approval_noDoubleSend_sequentialRepeats`, `approval_noDoubleSend_100ConcurrentCallers`, `approval_noDoubleSend_realThreadsWithApproveAndSendRacing`, `approval_noDoubleSend_failedAttemptIsNeverRetriedAutomatically` · A-E2E::`e2e_singleMessage_…ExactlyOnceAfterApproval`, `e2e_screenLocked_…thenExactlyOnce` · `BridgeCoordinatorTest::sendOnRealThreadsIsExactlyOnce` · `RemoteInputReplySenderTest::handleIsRemovedAfterAttemptSoNoSecondSend` | AUTOMATED | 20 סבבים × 32 קריאות במקביל על Threads אמיתיים |
| 7 | אין שליחה לשיחה אחרת | C-APPR::`approval_neverSendsToAnotherConversation`, `approval_manyConversations_eachSendGoesToItsOwnKeyWithItsOwnText` · A-E2E::`e2e_twoConversations_replyReachesOnlyTheApprovedChat`, `e2e_notificationSlotReusedByAnotherChat_neverRepliesIntoTheWrongConversation` · `ApprovalGuardTest::differentConversationRejected` | AUTOMATED + DEVICE_ONLY | מכשיר: R12 (Dual Messenger — שליחה מהמספר השני), S1 |
| 8 | תוצאה לא ידועה — בלי Retry | C-APPR::`approval_unknownResult_noRetryNoReapprovalNoResendOnNextMessage`, `approval_unknownResult_whenSendIsCancelledMidway` · C-FLOW::`scenario_crash_senderThrows_unknownResult_neverRetried` · `BridgeCoordinatorTest::unknownOutcomeIsUnknownResultWithoutRetry` | AUTOMATED | — |

### 13.3 — AI

| # | תרחיש | בדיקות (קובץ::שם) | סטטוס | הערות |
|---|---|---|---|---|
| 1 | עברית טבעית | P-AI::`test_natural_hebrew_stub_replies_are_short_hebrew_without_bot_markers`, `test_natural_hebrew_prompt_demands_israeli_hebrew_first_person_and_no_signature`, `test_natural_hebrew_output_guard_leaves_natural_replies_untouched` (ניקוד, מקף, גרש, RLM), `test_natural_hebrew_model_reply_passes_through_and_wrapping_is_removed` · P-API::`test_api_natural_hebrew_round_trip` | AUTOMATED + **NOT_COVERED** (איכות) | **איכות** העברית של מודל אמיתי לא נבדקה: דורשת קריאות בתשלום ושיפוט אנושי. מומלץ: סט 30 הודעות מייצגות + דירוג ידני |
| 2 | הקשר שיחה | P-AI::`test_context_all_burst_messages_reach_the_model_in_chronological_order`, `test_context_stub_answers_the_latest_message_of_the_burst`, `test_context_instruction_split_across_messages_is_still_detected`, `test_context_whole_burst_is_sent_in_one_request` · P-API::`test_api_context_whole_burst_reaches_engine_in_order` · C-FLOW::`scenario_consecutiveMessages_…` | AUTOMATED | ההקשר = ה-burst הנוכחי בלבד (עד 20 הודעות). אין היסטוריה — בכוונה (פרטיות) |
| 3 | בידוד בין שיחות | P-AI::`test_isolation_prompt_of_one_conversation_contains_nothing_of_another`, `test_isolation_engine_keeps_no_memory_between_requests`, `test_isolation_stub_is_a_pure_function_of_its_input` · P-API::`test_api_isolation_each_request_sees_only_its_own_conversation`, `test_api_isolation_between_devices` · C-FLOW::`scenario_parallel_interleavedBurstsNeverLeakAcrossConversations` | AUTOMATED | — |
| 4 | Prompt Injection | P-AI::`test_injection_is_flagged_with_hebrew_note_and_stub_deflects` (11 דוגמאות), `test_injection_text_lives_only_inside_the_untrusted_block`, `test_injection_model_that_complies_and_leaks_is_replaced_by_fallback`, `test_injection_requests_are_still_tool_free`, `test_injection_mixed_language_is_still_contained_structurally`, **`test_injection_mixed_language_is_flagged` (xfail — BUG QA-01)** · P-API::`test_api_injection_flagged_and_deflected_nothing_executed`, `test_api_has_no_endpoint_that_could_send_or_act` | AUTOMATED (BUG) | הזיהוי ההיוריסטי מפספס ערבוב עברית/אנגלית (QA-01). ההגנה המבנית (עטיפה, בלי כלים, אישור אנושי) מחזיקה — נבדק |
| 5 | תוכן רגיש | P-AI::`test_sensitive_request_is_flagged_noted_and_deflected` (10 דוגמאות: OTP, סיסמה, אשראי, ת"ז, בנק, ביט, paybox, כתובת, מיקום), `test_sensitive_exfiltration_of_other_chats_is_flagged`, `test_sensitive_model_output_with_codes_or_numbers_is_blocked`, `test_sensitive_benign_messages_are_not_flagged` · P-API::`test_api_sensitive_flagged_with_hebrew_note` | AUTOMATED + DEVICE_ONLY | מכשיר: R3 (Android 15 מסתיר OTP למאזין לא מהימן — המערכת עצמה) |
| 6 | תשובות שגויות (Output Guard) | P-AI::`test_wrong_answer_formatting_and_unknown_links_are_cleaned`, `test_wrong_answer_link_the_sender_wrote_is_kept`, `test_wrong_answer_empty_secret_or_leak_becomes_safe_fallback`, `test_wrong_answer_over_long_reply_is_capped`, `test_wrong_answer_refusal_or_non_text_blocks_give_fallback`, `test_wrong_answer_factual_commitments_are_left_for_the_human`, **`test_wrong_answer_guard_never_corrupts_a_reply_with_several_quoted_parts` (xfail — BUG QA-02)** | AUTOMATED (BUG) + **NOT_COVERED** (עובדות) | ה-Guard לא יכול לזהות עובדה מומצאת ("נתראה ב-20:00") — רק הנחיה בפרומפט + אישור אנושי. נבדק שזה המצב בפועל |
| 7 | הודעות ארוכות | P-API::`test_api_long_messages_exact_limits` (2000/2001, 20/21, 8000/8001, שם 80/81, 2000 אימוג'י), `test_api_413_never_echoes_content` · P-AI::`test_long_message_is_truncated_in_the_prompt_and_reply_stays_short`, `test_long_hebrew_burst_of_twenty_messages_gets_one_short_reply`, `test_wrong_answer_over_long_reply_is_capped` · A-MSG::`content_longHebrewMessageIsCutTo2000_andTotalBudgetKeepsNewest`, **`content_cutAt2000NeverSplitsAnEmoji` (@Ignore — BUG QA-03)** | AUTOMATED (BUG) | — |
| 8 | הודעות ריקות | P-API::`test_api_empty_messages_rejected_422` (4 צורות), `test_api_whitespace_only_message_is_accepted_and_answered_neutrally` · P-AI::`test_empty_message_text_never_crashes_and_gets_a_neutral_reply`, `test_empty_safety_report_for_empty_input` · A-MSG::`content_blankOnlyMessagesAreNeverSent` · C-FLOW::`scenario_missingNotification_hiddenOrRedactedContentNeverDrafted` (null/רווחים) | AUTOMATED | תצפית O-QA-2: השרת מקבל הודעה של רווחים בלבד (הטלפון לעולם לא שולח כזו) |
| 9 | אימוג'י | P-AI::`test_emoji_only_or_emoji_rich_messages_get_hebrew_replies`, `test_emoji_sequences_survive_the_output_guard_byte_exact` (ZWJ, גוון עור, דגל, keycap), `test_emoji_reach_the_model_as_visible_characters` · P-API::`test_api_emoji_round_trip_utf8` · A-MSG::`content_emojiMixedLanguageAndHebrewMarksArriveByteExact` · A-E2E::`e2e_edit_…EditedText` (אימוג'י ב-RemoteInput) | AUTOMATED | תצפית O-QA-3: `neutralize()` מוחק ZWJ בתוך הפרומפט בלבד (👨‍👩‍👧 → 👨👩👧) |
| 10 | ערבוב עברית/אנגלית | P-AI::`test_mixed_language_reply_language`, `test_mixed_language_text_is_preserved_by_the_guard_and_fallback_is_hebrew`, `test_mixed_language_sensitive_requests_are_detected`, `test_injection_mixed_language_is_flagged` (xfail — QA-01) · P-API::`test_api_mixed_language` · A-MSG::`content_emojiMixedLanguageAndHebrewMarksArriveByteExact` | AUTOMATED (BUG) | שפת התשובה לפי יחס אותיות: ≥80% לטיניות → אנגלית |

### 13.4 — רגרסיה של המערכות הקיימות

| # | רכיב | פקודה (כמו ב-CI) | סטטוס | הערות |
|---|---|---|---|---|
| 1 | backend | `pip install -r requirements-dev.txt` + `python -m pytest tests/ -v` (‏`ci.yml` job `backend`) | AUTOMATED | Python 3.11.18 |
| 2 | frontend | `npm ci` + `npm run lint` + `npm run build` (‏`ci.yml` job `frontend`) | AUTOMATED | — |
| 3 | smart-crm | `npm ci`, i18n index + diff, db bundle + diff, `typecheck`, `lint`, `test:unit`, `build` (‏`smart-crm.yml`) | AUTOMATED | — |
| 4 | RLS (‏`ci.yml` job `rls`) | migrations + `supabase/tests/test_rls.sql` על PostgreSQL 16 | **NOT_COVERED** | דורש שרת Postgres; ב-sandbox ‏`initdb` נכשל ואין docker (ראו BASELINE_REGRESSION §2). רץ ב-GitHub CI |
| 5 | smart-crm `test:integration`, schema drift, `test:e2e` | `smart-crm.yml` | **NOT_COVERED** | דורש Postgres (+Chromium ל-e2e). אותה סיבה |
| 6 | הוכחת אי-נגיעה | `git diff --stat c4ce0d7 HEAD -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge' ':!.github/workflows/noa-personal-bridge.yml'` | AUTOMATED | חייב להיות ריק |

**כלל:** ההרצה נעשית על עותק `git archive HEAD backend frontend smart-crm` בתיקיית scratch, לא בריפו, ומושווית לטבלה ב-BASELINE_REGRESSION.md.

---

## 6. קריטריוני יציאה

1. כל הבדיקות האוטומטיות עוברות, חוץ מבדיקות שמסומנות במפורש כבאג (`@Ignore` / `xfail(strict=True)`) ומתועדות ב-TEST_RESULTS.md.
2. `:app:lintDebug` ו-`:app:assembleDebug` עוברים.
3. רגרסיה זהה ל-baseline: backend 137 passed, frontend lint+build עוברים, smart-crm unit 164 passed + typecheck + lint + build.
4. פקודת ה-diff של 13.4 #6 ריקה.
5. **לפני הפעלת שליחה במכשיר:** כל בדיקות R0–R16 שרלוונטיות עברו במכשיר (ANDROID_FEASIBILITY §5), ו-S1–S3 בוצעו רק באישור מפורש ובכתב של המשתמש.

## 7. מה במכוון לא אוטומטי (סיכום)

| נושא | למה | איך בכל זאת |
|---|---|---|
| חיסכון בסוללה / Sleeping apps / Doze של Samsung | התנהגות One UI, אין סימולציה נאמנה | R14 במכשיר |
| התנהגות WhatsApp אמיתית (מבנה התראה, `reason` בהסרה, עדכון התראה, Reply בפועל) | אפליקציה סגורה של צד שלישי | R2–R8, R11, R15, S1–S3 |
| הסתרת תוכן רגיש של Android 15+ על המכשיר | תלוי ב-NotificationAssistant של Samsung | R3/R3b |
| Dual Messenger / פרופיל עבודה | דורש התקנה כפולה אמיתית | R12 (בלוגיקה: A-SVC בודק `sbn.user` אחר) |
| נעילת מסך אמיתית | ב-Robolectric הנעילה מוזרקת | R9 |
| איכות העברית והנכונות העובדתית של מודל אמיתי | עלות + שיפוט אנושי | הערכה ידנית מבוקרת, אחרי הסכמת המשתמש לעלות |
| RLS / אינטגרציה / e2e של smart-crm | דורש Postgres | GitHub CI |
