/**
 * מקטע "תוכנות ופרויקטים": עריכת רשימת התוכנות והפרויקטים שמותר ל-JARVIS לפתוח.
 * כל שינוי נשמר מיד דרך main (שמאמת את כל הרשימה). אימות נתיב ובדיקת פתיחה מתבצעים ב-main.
 */
import { useCallback, useId, useRef, useState } from 'react';
import type { AppEntry, ProjectEntry, Settings } from '../../shared/settings-schema';
import type { AppCandidate, PathValidation } from '../../shared/types';
import { he } from '../i18n/he';
import { useController } from '../state/controller';
import { ActionButton, ConfirmButton, SaveStatus, Select, TextInput, Toggle, type SaveState, type Saver, type SectionProps } from './fields';
import {
  addAlias,
  appKindFromPath,
  findMatchingApp,
  makeUniqueId,
  newCustomApp,
  newProject,
  pickPurposeForProject,
  removeAlias,
} from './helpers';

const t = he.settings.launcher;
type Launcher = Settings['launcher'];
type CheckResult = { ok: boolean; text: string } | null;

function CheckLine({ result }: { result: CheckResult }) {
  if (!result) return null;
  return (
    <p className={result.ok ? 'check-line' : 'check-line field-error'} data-ok={result.ok ? 'on' : undefined} role={result.ok ? 'status' : 'alert'}>
      <span className="check-mark" aria-hidden="true">
        {result.ok ? t.validOk : t.validBad}
      </span>{' '}
      {result.text}
    </p>
  );
}

function validationToCheck(v: PathValidation): CheckResult {
  return { ok: v.ok, text: v.message_he };
}

/* ---------------- כינויים ---------------- */

function AliasEditor({ aliases, maxLen, onChange }: { aliases: string[]; maxLen: number; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {t.aliases}
      </label>
      <div className="alias-box">
        {aliases.map((a) => (
          <span key={a} className="alias-chip">
            <span dir="auto">{a}</span>
            <button type="button" className="alias-remove" aria-label={t.aliasRemove(a)} onClick={() => onChange(removeAlias(aliases, a))}>
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          className="alias-input"
          dir={draft ? 'auto' : 'rtl'}
          value={draft}
          maxLength={maxLen}
          placeholder={t.aliasAdd}
          disabled={aliases.length >= 20}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const next = addAlias(aliases, draft, maxLen);
              setDraft('');
              if (next.length !== aliases.length) onChange(next);
            }
          }}
        />
      </div>
    </div>
  );
}

/* ---------------- תוכנה ---------------- */

function AppRow({
  app,
  status,
  onChange,
  onRemove,
}: {
  app: AppEntry;
  status: SaveState | undefined;
  onChange: (patch: Partial<AppEntry>) => void;
  onRemove: () => Promise<void>;
}) {
  const controller = useController();
  const [check, setCheck] = useState<CheckResult>(null);

  return (
    <li className="entry" data-disabled={app.enabled ? undefined : 'on'}>
      <div className="entry-head">
        <TextInput
          key={`n-${app.name}`}
          label={t.name}
          value={app.name}
          maxLength={60}
          validate={(v) => (v.trim() ? null : he.settings.general.userNameEmpty)}
          onCommit={(v) => onChange({ name: v.trim() })}
        />
        {app.builtin && <span className="tag">{t.builtin}</span>}
        <Toggle label={t.enabled} checked={app.enabled} onChange={(v) => onChange({ enabled: v })} />
      </div>
      <AliasEditor aliases={app.aliases} maxLen={60} onChange={(aliases) => onChange({ aliases })} />
      <div className="entry-grid">
        <Select
          label={t.kind}
          value={app.kind}
          options={(['exe', 'shortcut', 'uri'] as const).map((k) => ({ value: k, label: t.appKinds[k] }))}
          onChange={(kind) => {
            setCheck(null);
            onChange({ kind });
          }}
        />
        <TextInput
          key={`t-${app.target}`}
          label={t.target}
          value={app.target}
          ltr
          maxLength={1024}
          placeholder={app.kind === 'uri' ? 'spotify:' : 'C:\\Program Files\\…\\app.exe'}
          onCommit={(v) => {
            setCheck(null);
            onChange({ target: v.trim() });
          }}
        />
      </div>
      <div className="entry-actions">
        {app.kind !== 'uri' && (
          <ActionButton
            label={t.pick}
            onRun={async () => {
              try {
                const path = await controller.api.settings.pickPath('app-exe');
                if (!path) return;
                setCheck(null);
                onChange({ target: path, kind: appKindFromPath(path) ?? app.kind });
              } catch {
                setCheck({ ok: false, text: he.settings.saveFailed });
              }
            }}
          />
        )}
        <ActionButton
          label={t.validate}
          disabled={!app.target}
          onRun={async () => {
            try {
              setCheck(validationToCheck(await controller.api.settings.validatePath({ path: app.target, expected: app.kind })));
            } catch {
              setCheck({ ok: false, text: he.errors.ipc('validatePath') });
            }
          }}
        />
        <ActionButton
          label={t.testOpen}
          disabled={!app.target || !app.enabled}
          onRun={async () => {
            try {
              const res = await controller.api.settings.testOpen({ kind: 'app', id: app.id });
              setCheck(res.ok ? { ok: true, text: res.summary_he } : { ok: false, text: res.message_he });
            } catch {
              setCheck({ ok: false, text: he.errors.ipc('testOpen') });
            }
          }}
        />
        {!app.builtin && <ConfirmButton label={he.settings.remove} confirmText={t.removeConfirm(app.name)} onConfirm={onRemove} />}
      </div>
      {app.builtin && <p className="field-hint">{t.builtinNoDelete}</p>}
      {!app.target && <p className="field-hint">{t.emptyPath}</p>}
      <CheckLine result={check} />
      <SaveStatus status={status} />
    </li>
  );
}

/* ---------------- פרויקט ---------------- */

function ProjectRow({
  project,
  isDefault,
  status,
  onChange,
  onMakeDefault,
  onRemove,
}: {
  project: ProjectEntry;
  isDefault: boolean;
  status: SaveState | undefined;
  onChange: (patch: Partial<ProjectEntry>) => void;
  onMakeDefault: () => void;
  onRemove: () => Promise<void>;
}) {
  const controller = useController();
  const [check, setCheck] = useState<CheckResult>(null);

  return (
    <li className="entry" data-disabled={project.enabled ? undefined : 'on'}>
      <div className="entry-head">
        <TextInput
          key={`n-${project.name}`}
          label={t.name}
          value={project.name}
          maxLength={80}
          validate={(v) => (v.trim() ? null : he.settings.general.userNameEmpty)}
          onCommit={(v) => onChange({ name: v.trim() })}
        />
        <label className="radio-row default-radio">
          <input type="radio" name="default-project" checked={isDefault} onChange={onMakeDefault} />
          <span>{t.defaultProject}</span>
        </label>
        <Toggle label={t.enabled} checked={project.enabled} onChange={(v) => onChange({ enabled: v })} />
      </div>
      <AliasEditor aliases={project.aliases} maxLen={80} onChange={(aliases) => onChange({ aliases })} />
      <div className="entry-grid">
        <Select
          label={t.kind}
          value={project.kind}
          options={(['eplan', 'file', 'folder'] as const).map((k) => ({ value: k, label: t.projectKinds[k] }))}
          onChange={(kind) => {
            setCheck(null);
            onChange({ kind });
          }}
        />
        <TextInput
          key={`p-${project.path}`}
          label={t.path}
          value={project.path}
          ltr
          maxLength={1024}
          placeholder={project.kind === 'folder' ? 'D:\\Projects\\…' : 'D:\\Projects\\…\\project.elk'}
          onCommit={(v) => {
            setCheck(null);
            onChange({ path: v.trim() });
          }}
        />
      </div>
      <div className="entry-actions">
        <ActionButton
          label={project.kind === 'folder' ? t.pickFolder : t.pick}
          onRun={async () => {
            try {
              const path = await controller.api.settings.pickPath(pickPurposeForProject(project.kind));
              if (!path) return;
              setCheck(null);
              onChange({ path });
            } catch {
              setCheck({ ok: false, text: he.settings.saveFailed });
            }
          }}
        />
        <ActionButton
          label={t.validate}
          disabled={!project.path}
          onRun={async () => {
            try {
              setCheck(validationToCheck(await controller.api.settings.validatePath({ path: project.path, expected: project.kind })));
            } catch {
              setCheck({ ok: false, text: he.errors.ipc('validatePath') });
            }
          }}
        />
        <ActionButton
          label={t.testOpen}
          disabled={!project.path || !project.enabled}
          onRun={async () => {
            try {
              const res = await controller.api.settings.testOpen({ kind: 'project', id: project.id });
              setCheck(res.ok ? { ok: true, text: res.summary_he } : { ok: false, text: res.message_he });
            } catch {
              setCheck({ ok: false, text: he.errors.ipc('testOpen') });
            }
          }}
        />
        <ConfirmButton label={he.settings.remove} confirmText={t.removeConfirm(project.name)} onConfirm={onRemove} />
      </div>
      {!project.path && <p className="field-hint">{t.emptyPath}</p>}
      <CheckLine result={check} />
      <SaveStatus status={status} />
    </li>
  );
}

/* ---------------- זיהוי אוטומטי ---------------- */

function DetectApps({ apps, onAdd, onAssign }: { apps: AppEntry[]; onAdd: (c: AppCandidate) => void; onAssign: (app: AppEntry, c: AppCandidate) => void }) {
  const controller = useController();
  const [candidates, setCandidates] = useState<AppCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="detect">
      <ActionButton
        label={t.detect}
        onRun={async () => {
          setError(null);
          try {
            setCandidates(await controller.api.settings.detectApps());
          } catch {
            setError(t.detectFailed);
          }
        }}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {candidates && candidates.length === 0 && <p className="field-hint">{t.detectNone}</p>}
      {candidates && candidates.length > 0 && (
        <div className="suggestions">
          <h4 className="sub-head">{t.suggestions}</h4>
          <ul className="list">
            {candidates.map((c) => {
              const match = findMatchingApp(apps, c);
              const alreadySet = match && match.target === c.path;
              return (
                <li key={`${c.suggestedId}-${c.path}`} className="list-row">
                  <div className="list-main">
                    <span className="list-title">{c.name}</span>
                    <span className="list-sub mono" dir="ltr">
                      {c.path}
                    </span>
                  </div>
                  {!alreadySet && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (match) onAssign(match, c);
                        else onAdd(c);
                        setCandidates((list) => list?.filter((x) => x !== c) ?? null);
                      }}
                    >
                      {match ? t.assignSuggestion(match.name) : t.useSuggestion}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------- המקטע ---------------- */

/**
 * עדכונים לרשימות התוכנות/הפרויקטים. המערכים נשמרים בשלמותם, ולכן כל שינוי מחושב
 * מההגדרות העדכניות ביותר ורק אחרי שהשמירה הקודמת הסתיימה — שני שינויים מהירים לא ידרסו זה את זה.
 */
function useLauncherMutations(saver: Saver) {
  const controller = useController();
  const { save } = saver;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback(
    (field: string, mutate: (launcher: Launcher) => Partial<Launcher> | null): Promise<boolean> => {
      const run = queue.current.then(async () => {
        const current = controller.state.settings?.launcher;
        if (!current) return false;
        const patch = mutate(current);
        return patch ? save(field, { launcher: patch }) : false;
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    [controller, save],
  );
}

export function LauncherSection({ settings, saver }: SectionProps) {
  const { apps, projects, defaultProjectId } = settings.launcher;
  const mutate = useLauncherMutations(saver);

  const updateApp = (id: string, patch: Partial<AppEntry>) =>
    void mutate(`app:${id}`, (l) => ({ apps: l.apps.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const removeApp = async (id: string) => {
    await mutate('apps', (l) => ({ apps: l.apps.filter((a) => a.id !== id) }));
  };
  const addApp = (make: (apps: AppEntry[]) => AppEntry) =>
    void mutate('apps', (l) => {
      if (l.apps.length >= 50) {
        saver.setError('apps', t.limitApps);
        return null;
      }
      return { apps: [...l.apps, make(l.apps)] };
    });
  const addFromCandidate = (c: AppCandidate) =>
    addApp((list) => ({
      id: makeUniqueId(c.suggestedId || c.name, list.map((a) => a.id), 'app'),
      name: c.name.slice(0, 60),
      aliases: [],
      kind: c.kind,
      target: c.path,
      args: [],
      enabled: true,
      builtin: false,
    }));

  const updateProject = (id: string, patch: Partial<ProjectEntry>) =>
    void mutate(`project:${id}`, (l) => ({ projects: l.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const removeProject = async (id: string) => {
    await mutate('projects', (l) => ({
      projects: l.projects.filter((p) => p.id !== id),
      ...(l.defaultProjectId === id ? { defaultProjectId: '' } : {}),
    }));
  };
  const addProject = () =>
    void mutate('projects', (l) => {
      if (l.projects.length >= 30) {
        saver.setError('projects', t.limitProjects);
        return null;
      }
      return { projects: [...l.projects, newProject(l.projects)] };
    });

  return (
    <div className="section">
      <h3 className="section-head">{t.appsTitle}</h3>
      <ul className="entries">
        {apps.map((app) => (
          <AppRow
            key={app.id}
            app={app}
            status={saver.status[`app:${app.id}`]}
            onChange={(patch) => updateApp(app.id, patch)}
            onRemove={() => removeApp(app.id)}
          />
        ))}
      </ul>
      <div className="entry-actions">
        <button
          type="button"
          className="btn"
          onClick={() => addApp(newCustomApp)}
        >
          {t.addApp}
        </button>
        <DetectApps apps={apps} onAdd={addFromCandidate} onAssign={(app, c) => updateApp(app.id, { target: c.path, kind: c.kind })} />
      </div>
      <SaveStatus status={saver.status.apps} />

      <h3 className="section-head">{t.projectsTitle}</h3>
      <p className="privacy-note" role="note">
        {t.eplanNote}
      </p>
      <ul className="entries">
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            isDefault={project.id === defaultProjectId}
            status={saver.status[`project:${project.id}`]}
            onChange={(patch) => updateProject(project.id, patch)}
            onMakeDefault={() => void mutate(`project:${project.id}`, () => ({ defaultProjectId: project.id }))}
            onRemove={() => removeProject(project.id)}
          />
        ))}
      </ul>
      <div className="entry-actions">
        <button
          type="button"
          className="btn"
          onClick={addProject}
        >
          {t.addProject}
        </button>
      </div>
      <SaveStatus status={saver.status.projects} />
    </div>
  );
}
