import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/shared/settings-schema';
import {
  isCancelCommand,
  parseLocalIntent,
  pendingFromToolResult,
  resolveClarification,
  MUSIC_ACK_HE,
  type LocalIntent,
  type PendingClarification,
} from '../../../src/main/conversation/local-intents';

// יום שני, 5 באוקטובר 2026, 20:15 שעון ישראל (UTC+3)
const NOW = new Date('2026-10-05T17:15:00Z');
const settings = defaultSettings();

function parse(text: string, now: Date = NOW): LocalIntent {
  return parseLocalIntent(text, settings, now);
}

function expectTool(intent: LocalIntent, tool: string, input: Record<string, unknown>): void {
  expect(intent.kind).toBe('tool');
  if (intent.kind !== 'tool') return;
  expect(intent.tool).toBe(tool);
  expect(intent.input).toEqual(input);
}

function expectClarify(intent: LocalIntent): { question: string; pending: PendingClarification } {
  expect(intent.kind).toBe('clarify');
  if (intent.kind !== 'clarify') throw new Error('not clarify');
  return { question: intent.question_he, pending: intent.pending };
}

describe('local intents — apps and projects', () => {
  it('Jarvis, תפתח EPLAN -> open_application eplan', () => {
    expectTool(parse('Jarvis, תפתח EPLAN'), 'open_application', { app_id: 'eplan' });
  });

  it("ג'רוויס תפתח את אי פלאן -> eplan (Hebrew alias)", () => {
    expectTool(parse("ג'רוויס תפתח את אי פלאן"), 'open_application', { app_id: 'eplan' });
  });

  it('פתח Spotify', () => {
    expectTool(parse('פתח Spotify'), 'open_application', { app_id: 'spotify' });
  });

  it('open notepad', () => {
    expectTool(parse('open notepad'), 'open_application', { app_id: 'notepad' });
  });

  it('תפתח את פרויקט הגמר שלי -> open_project final-project', () => {
    expectTool(parse('תפתח את פרויקט הגמר שלי'), 'open_project', { project_id: 'final-project' });
  });

  it('תפתח את הפרויקט -> default project', () => {
    expectTool(parse('תפתח את הפרויקט'), 'open_project', { project_id: 'final-project' });
  });

  it('unknown app goes to the tool by name (tool answers NOT_ALLOWLISTED), never to the OS', () => {
    expectTool(parse('תפתח את וורד'), 'open_application', { app_name: 'וורד' });
  });

  it('several matching projects -> passes the name to the tool (no guessing)', () => {
    const s = defaultSettings();
    s.launcher.projects.push({ id: 'lab-a', name: 'פרויקט מעבדה', aliases: ['מעבדה 1'], path: '', kind: 'eplan', enabled: true });
    s.launcher.projects.push({ id: 'lab-b', name: 'פרויקט מעבדה', aliases: ['מעבדה 2'], path: '', kind: 'eplan', enabled: true });
    const intent = parseLocalIntent('תפתח את פרויקט מעבדה', s, NOW);
    expect(intent.kind).toBe('tool');
    if (intent.kind === 'tool') {
      expect(intent.tool).toBe('open_project');
      expect(intent.input.project_id).toBeUndefined();
      expect(intent.input.project_name).toBe('פרויקט מעבדה');
    }
  });

  it('open with nothing -> asks what to open', () => {
    expect(parse('תפתח').kind).toBe('reply');
  });
});

describe('local intents — status, tasks, screen, music, cancel', () => {
  it('Jarvis, מצב מערכת. -> get_system_status', () => {
    expectTool(parse('Jarvis, מצב מערכת.'), 'get_system_status', {});
  });

  it('מה יש לי לעשות היום? -> list_tasks today', () => {
    expectTool(parse('מה יש לי לעשות היום?'), 'list_tasks', { filter: 'today' });
  });

  it('מה המשימות שלי -> list_tasks open', () => {
    expectTool(parse('מה המשימות שלי'), 'list_tasks', { filter: 'open' });
  });

  it('תוסיף משימה לסיים את השרטוט -> create_task (title keeps final letters)', () => {
    expectTool(parse('תוסיף משימה לסיים את השרטוט'), 'create_task', { title: 'לסיים את השרטוט' });
  });

  it('task with "עד מחר" gets a due date', () => {
    expectTool(parse('תוסיף משימה לשלוח את הדוח עד מחר'), 'create_task', { title: 'לשלוח את הדוח', due_date: '2026-10-06' });
  });

  it('סיימתי את המשימה לסיים את השרטוט -> complete_task title_query', () => {
    expectTool(parse('סיימתי את המשימה לסיים את השרטוט'), 'complete_task', { title_query: 'לסיים את השרטוט' });
  });

  it('תסתכל על המסך ותגיד לי מה לא בסדר -> capture_screen_for_analysis', () => {
    expectTool(parse('תסתכל על המסך ותגיד לי מה לא בסדר'), 'capture_screen_for_analysis', {
      question: 'תסתכל על המסך ותגיד לי מה לא בסדר',
    });
  });

  it('תנגן מוזיקה -> opens Spotify with a note that playback control is not connected', () => {
    const intent = parse('תנגן מוזיקה');
    expectTool(intent, 'open_application', { app_id: 'spotify' });
    if (intent.kind === 'tool') expect(intent.ack_he).toBe(MUSIC_ACK_HE);
  });

  it('music control is answered honestly (not connected)', () => {
    const intent = parse('תעבור לשיר הבא');
    expect(intent.kind).toBe('reply');
  });

  it.each(['עצור', 'בטל', 'stop', 'cancel', "ג'רוויס, עצור!", 'Cancel.'])('"%s" alone -> cancel', (text) => {
    expect(parse(text).kind).toBe('cancel');
    expect(isCancelCommand(text)).toBe(true);
  });

  it('"בטל את התזכורת לשתות מים" is not a bare cancel', () => {
    expect(isCancelCommand('בטל את התזכורת לשתות מים')).toBe(false);
  });

  it('unknown text -> none', () => {
    expect(parse('מה מזג האוויר בתל אביב').kind).toBe('none');
  });

  it('just the wake word -> short reply', () => {
    expect(parse("ג'רוויס").kind).toBe('reply');
  });
});

describe('local intents — reminders', () => {
  it('מחר בשמונה בבוקר -> tomorrow 08:00 with text', () => {
    expectTool(parse('תזכיר לי מחר בשמונה בבוקר לפתוח את הפרויקט'), 'create_reminder', {
      text: 'לפתוח את הפרויקט',
      date: '2026-10-06',
      time: '08:00',
    });
  });

  it('ambiguous "בשמונה" asks morning/evening, then "בערב" resolves to 20:00', () => {
    const { question, pending } = expectClarify(parse('תזכיר לי מחר בשמונה לפתוח את הפרויקט'));
    expect(question).toBe('בשמונה בבוקר או בערב?');
    expectTool(resolveClarification(pending, 'בערב', settings, NOW), 'create_reminder', {
      text: 'לפתוח את הפרויקט',
      date: '2026-10-06',
      time: '20:00',
    });
  });

  it('clarification answer "בבוקר" -> 08:00, and "בטל" cancels', () => {
    const { pending } = expectClarify(parse('תזכיר לי מחר בשמונה לפתוח את הפרויקט'));
    expectTool(resolveClarification(pending, 'בבוקר', settings, NOW), 'create_reminder', {
      text: 'לפתוח את הפרויקט',
      date: '2026-10-06',
      time: '08:00',
    });
    expect(resolveClarification(pending, 'בטל', settings, NOW).kind).toBe('cancel');
    expect(resolveClarification(pending, 'מה מזג האוויר', settings, NOW).kind).toBe('none');
  });

  it('explicit 24h time: מחר ב-20:30', () => {
    expectTool(parse('תזכיר לי מחר ב-20:30 לשלוח את הדוח'), 'create_reminder', {
      text: 'לשלוח את הדוח',
      date: '2026-10-06',
      time: '20:30',
    });
  });

  it('בעוד 10 דקות', () => {
    expectTool(parse('תזכיר לי בעוד 10 דקות לשתות מים'), 'create_reminder', {
      text: 'לשתות מים',
      date: '2026-10-05',
      time: '20:25',
    });
  });

  it('בעוד חצי שעה / בעוד שעתיים / בעוד עשר דקות (words)', () => {
    expectTool(parse('תזכיר לי בעוד חצי שעה להוציא את הכביסה'), 'create_reminder', {
      text: 'להוציא את הכביסה',
      date: '2026-10-05',
      time: '20:45',
    });
    expectTool(parse('תזכיר לי בעוד שעתיים להתקשר לאמא'), 'create_reminder', {
      text: 'להתקשר לאמא',
      date: '2026-10-05',
      time: '22:15',
    });
    expectTool(parse('תזכיר לי לשתות מים בעוד עשר דקות'), 'create_reminder', {
      text: 'לשתות מים',
      date: '2026-10-05',
      time: '20:25',
    });
  });

  it('relative minutes round up to the next whole minute', () => {
    const now = new Date('2026-10-05T17:15:40Z');
    expectTool(parse('תזכיר לי בעוד 10 דקות לשתות מים', now), 'create_reminder', {
      text: 'לשתות מים',
      date: '2026-10-05',
      time: '20:26',
    });
  });

  it('weekday: ביום חמישי בעשר בבוקר -> next Thursday 10:00', () => {
    expectTool(parse('תזכיר לי ביום חמישי בעשר בבוקר להתקשר לספק'), 'create_reminder', {
      text: 'להתקשר לספק',
      date: '2026-10-08',
      time: '10:00',
    });
  });

  it('same weekday as today means next week', () => {
    expectTool(parse('תזכיר לי ביום שני ב-9:00 לשלם חשבון'), 'create_reminder', {
      text: 'לשלם חשבון',
      date: '2026-10-12',
      time: '09:00',
    });
  });

  it('D/M date in Israeli order: ב-12/10 בשעה 9:00', () => {
    expectTool(parse('תזכיר לי ב-12/10 בשעה 9:00 לבדוק את הלוח'), 'create_reminder', {
      text: 'לבדוק את הלוח',
      date: '2026-10-12',
      time: '09:00',
    });
  });

  it('D/M date that already passed this year -> next year', () => {
    expectTool(parse('תזכיר לי ב-3/2 ב-10:00 לחדש ביטוח'), 'create_reminder', {
      text: 'לחדש ביטוח',
      date: '2027-02-03',
      time: '10:00',
    });
  });

  it('Hebrew month name: ב-20 בנובמבר בשעה 14:00', () => {
    expectTool(parse('תזכיר לי ב-20 בנובמבר בשעה 14:00 להגיש את העבודה'), 'create_reminder', {
      text: 'להגיש את העבודה',
      date: '2026-11-20',
      time: '14:00',
    });
  });

  it('וחצי / ורבע with periods', () => {
    expectTool(parse('תזכיר לי מחר בשמונה וחצי בערב לצפות במשחק'), 'create_reminder', {
      text: 'לצפות במשחק',
      date: '2026-10-06',
      time: '20:30',
    });
    expectTool(parse('תזכיר לי מחר בשבע ורבע בבוקר לצאת'), 'create_reminder', {
      text: 'לצאת',
      date: '2026-10-06',
      time: '07:15',
    });
  });

  it('רבע ל: ברבע לתשע בבוקר -> 08:45', () => {
    expectTool(parse('תזכיר לי מחר ברבע לתשע בבוקר לצאת'), 'create_reminder', {
      text: 'לצאת',
      date: '2026-10-06',
      time: '08:45',
    });
  });

  it('בצהריים: 1 -> 13:00, 12 -> 12:00; bare "בצהריים" -> 12:00', () => {
    expectTool(parse('תזכיר לי מחר באחת בצהריים לאכול'), 'create_reminder', { text: 'לאכול', date: '2026-10-06', time: '13:00' });
    expectTool(parse('תזכיר לי מחר בשתים עשרה בצהריים לאכול'), 'create_reminder', { text: 'לאכול', date: '2026-10-06', time: '12:00' });
    expectTool(parse('תזכיר לי מחר בצהריים לאכול'), 'create_reminder', { text: 'לאכול', date: '2026-10-06', time: '12:00' });
  });

  it('אחר הצהריים / בערב / בלילה', () => {
    expectTool(parse('תזכיר לי מחר בארבע אחר הצהריים לאסוף את הילדים'), 'create_reminder', {
      text: 'לאסוף את הילדים',
      date: '2026-10-06',
      time: '16:00',
    });
    expectTool(parse('תזכיר לי מחר בתשע בערב לכבות את הדוד'), 'create_reminder', {
      text: 'לכבות את הדוד',
      date: '2026-10-06',
      time: '21:00',
    });
    expectTool(parse('תזכיר לי מחר בעשר בלילה לנעול'), 'create_reminder', { text: 'לנעול', date: '2026-10-06', time: '22:00' });
  });

  it('"הערב" gives context, so "הערב בתשע" is 21:00 without asking', () => {
    expectTool(parse('תזכיר לי הערב בתשע לסגור את החלון'), 'create_reminder', {
      text: 'לסגור את החלון',
      date: '2026-10-05',
      time: '21:00',
    });
  });

  it('day without time -> asks "באיזו שעה", then the answer completes it', () => {
    const { question, pending } = expectClarify(parse('תזכיר לי מחר לקנות חלב'));
    expect(question).toContain('באיזו שעה');
    expectTool(resolveClarification(pending, 'ב-17:00', settings, NOW), 'create_reminder', {
      text: 'לקנות חלב',
      date: '2026-10-06',
      time: '17:00',
    });
  });

  it('time-only answer that is still ambiguous asks morning/evening again', () => {
    const { pending } = expectClarify(parse('תזכיר לי מחר לקנות חלב'));
    const second = expectClarify(resolveClarification(pending, 'בחמש', settings, NOW));
    expect(second.question).toBe('בחמש בבוקר או בערב?');
    expectTool(resolveClarification(second.pending, 'אחר הצהריים', settings, NOW), 'create_reminder', {
      text: 'לקנות חלב',
      date: '2026-10-06',
      time: '17:00',
    });
  });

  it('no text -> asks what to remind about', () => {
    const { question, pending } = expectClarify(parse('תזכיר לי מחר ב-10:00'));
    expect(question).toBe('על מה להזכיר לך?');
    expectTool(resolveClarification(pending, 'לשלם חשבון חשמל', settings, NOW), 'create_reminder', {
      text: 'לשלם חשבון חשמל',
      date: '2026-10-06',
      time: '10:00',
    });
  });

  it('a time already passed today with no day given -> next occurrence (tomorrow)', () => {
    expectTool(parse('תזכיר לי בשמונה בבוקר לעשות ספורט'), 'create_reminder', {
      text: 'לעשות ספורט',
      date: '2026-10-06',
      time: '08:00',
    });
    expectTool(parse('תזכיר לי ב-21:00 לעשות ספורט'), 'create_reminder', {
      text: 'לעשות ספורט',
      date: '2026-10-05',
      time: '21:00',
    });
  });

  it('near midnight: "בעוד 20 דקות" at 23:50 crosses to the next day; "מחר" is the next calendar day', () => {
    const nearMidnight = new Date('2026-10-05T20:50:00Z'); // 23:50 בישראל
    expectTool(parse('תזכיר לי בעוד 20 דקות לכבות את המחשב', nearMidnight), 'create_reminder', {
      text: 'לכבות את המחשב',
      date: '2026-10-06',
      time: '00:10',
    });
    expectTool(parse('תזכיר לי מחר בשמונה בבוקר לקום', nearMidnight), 'create_reminder', {
      text: 'לקום',
      date: '2026-10-06',
      time: '08:00',
    });
    const afterMidnight = new Date('2026-10-05T21:10:00Z'); // 00:10 ב-6 באוקטובר
    expectTool(parse('תזכיר לי מחר בשמונה בבוקר לקום', afterMidnight), 'create_reminder', {
      text: 'לקום',
      date: '2026-10-07',
      time: '08:00',
    });
  });

  it('across the Oct 25 2026 DST change (clocks go back at 02:00 IDT)', () => {
    // 24 באוקטובר 22:00 שעון קיץ (UTC+3)
    const beforeChange = new Date('2026-10-24T19:00:00Z');
    expectTool(parse('תזכיר לי מחר בשמונה בבוקר לפתוח את הפרויקט', beforeChange), 'create_reminder', {
      text: 'לפתוח את הפרויקט',
      date: '2026-10-25',
      time: '08:00',
    });
    // 25 באוקטובר 00:30 (UTC+3). בעוד 3 שעות = 00:30Z = 02:30 שעון חורף (UTC+2) — רק שעתיים "על השעון"
    const justBefore = new Date('2026-10-24T21:30:00Z');
    expectTool(parse('תזכיר לי בעוד 3 שעות לבדוק את הגיבוי', justBefore), 'create_reminder', {
      text: 'לבדוק את הגיבוי',
      date: '2026-10-25',
      time: '02:30',
    });
  });

  it('bare reminders list and "מה התזכורות שלי" -> list_reminders upcoming', () => {
    expectTool(parse('תזכורות'), 'list_reminders', { filter: 'upcoming' });
    expectTool(parse('מה התזכורות שלי'), 'list_reminders', { filter: 'upcoming' });
    expectTool(parse('אילו תזכורות פספסתי'), 'list_reminders', { filter: 'missed' });
  });

  it('בטל את התזכורת לשתות מים -> cancel_reminder', () => {
    expectTool(parse('בטל את התזכורת לשתות מים'), 'cancel_reminder', { text_query: 'לשתות מים' });
  });

  it('Hebrew number words 1-12 as hours', () => {
    const words: Array<[string, string]> = [
      ['באחת', '13:00'],
      ['בשתיים', '14:00'],
      ['בשתים', '14:00'],
      ['בשלוש', '15:00'],
      ['בארבע', '16:00'],
      ['בחמש', '17:00'],
      ['בשש', '18:00'],
      ['בשבע', '19:00'],
      ['בשמונה', '20:00'],
      ['בתשע', '21:00'],
      ['בעשר', '22:00'],
      ['באחת עשרה', '23:00'],
    ];
    for (const [word, time] of words) {
      expectTool(parse(`תזכיר לי מחר ${word} בערב לבדוק`), 'create_reminder', { text: 'לבדוק', date: '2026-10-06', time });
    }
    expectTool(parse('תזכיר לי מחר בשתים עשרה בצהריים לבדוק'), 'create_reminder', { text: 'לבדוק', date: '2026-10-06', time: '12:00' });
  });
});

describe('choice clarification from tool options', () => {
  it('needs_clarification with options -> pending; "השני" or a name picks it', () => {
    const pending = pendingFromToolResult('open_project', {
      ok: false,
      status: 'needs_clarification',
      summary_he: 'איזה פרויקט?',
      options: [
        { id: 'final-project', label: 'פרויקט הגמר' },
        { id: 'lab', label: 'פרויקט המעבדה' },
      ],
    });
    expect(pending).not.toBeNull();
    if (!pending) return;
    expectTool(resolveClarification(pending, 'השני', settings, NOW), 'open_project', { project_id: 'lab' });
    expectTool(resolveClarification(pending, 'פרויקט המעבדה', settings, NOW), 'open_project', { project_id: 'lab' });
    expect(resolveClarification(pending, 'משהו אחר לגמרי', settings, NOW).kind).toBe('none');
  });

  it('no options -> no pending', () => {
    expect(pendingFromToolResult('open_project', { ok: false, status: 'error', summary_he: 'x' })).toBeNull();
  });
});
