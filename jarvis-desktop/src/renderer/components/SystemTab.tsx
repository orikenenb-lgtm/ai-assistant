/**
 * לשונית "מערכת": מעבד, זיכרון, כוננים, סוללה ושירותים.
 * נמשך מ-main כל 3 שניות — רק כשהלשונית מוצגת והחלון גלוי. בלי טמפרטורות (אין מקור אמין ב-Windows).
 */
import { useEffect, useState } from 'react';
import type { ServiceStatus, SystemStatus } from '../../shared/types';
import { useDocumentVisible } from '../hooks/environment';
import { he } from '../i18n/he';
import { useController } from '../state/controller';
import { formatBytes, formatPercent, formatShortTime, formatUptime } from '../state/format';

const POLL_MS = 3000;

function Meter({ label, percent, detail, ltr = false }: { label: string; percent: number | null; detail?: string; ltr?: boolean }) {
  const value = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const tone = percent === null ? 'dim' : value >= 90 ? 'red' : value >= 75 ? 'amber' : 'cyan';
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label" dir={ltr ? 'ltr' : undefined}>
          {label}
        </span>
        <span className="hud-num" dir="ltr">
          {percent === null ? he.system.notAvailable : formatPercent(percent)}
        </span>
      </div>
      <div
        className="bar"
        data-tone={tone}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? undefined : Math.round(value)}
      >
        <span style={{ inlineSize: `${value}%` }} />
      </div>
      {detail && <div className="meter-detail">{detail}</div>}
    </div>
  );
}

function ServiceRow({ service }: { service: ServiceStatus }) {
  const tone =
    service.state === 'ok' ? 'green' : service.state === 'error' ? 'red' : service.state === 'not_configured' ? 'amber' : 'dim';
  return (
    <li className="service-row" title={service.lastError_he}>
      <span className="chip-dot" data-tone={tone} aria-hidden="true" />
      <span className="service-name">{he.system.serviceNames[service.service]}</span>
      <span className="service-provider mono" dir="ltr">
        {service.provider}
      </span>
      <span className="service-state" data-tone={tone}>
        {he.system.serviceStates[service.state]}
      </span>
      {service.lastError_he && <span className="service-error">{service.lastError_he}</span>}
    </li>
  );
}

export function SystemTab() {
  const controller = useController();
  const visible = useDocumentVisible();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    let timer: number | undefined;
    // שרשרת setTimeout (לא setInterval): בקשה איטית לא תיערם על הבאה
    const poll = async () => {
      try {
        const next = await controller.api.system.status();
        if (!alive) return;
        setStatus(next);
        setFailed(false);
        controller.reportServices(next.services);
      } catch {
        if (alive) setFailed(true);
      }
      if (alive) timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [visible, controller]);

  if (!status) {
    return <p className={failed ? 'inline-error' : 'empty-note'}>{failed ? he.system.loadFailed : he.system.loading}</p>;
  }

  const { cpu, memory, disks, battery, services } = status;
  return (
    <div className="system">
      {failed && <p className="inline-error">{he.system.loadFailed}</p>}
      <Meter label={he.system.cpu} percent={cpu.usagePercent} detail={he.system.cores(cpu.cores)} />
      <Meter
        label={he.system.ram}
        percent={memory.usagePercent}
        detail={he.system.used(formatBytes(memory.usedBytes), formatBytes(memory.totalBytes))}
      />
      {disks.length > 0 && <h3 className="sub-head">{he.system.disks}</h3>}
      {disks.map((d) => (
        <Meter key={d.mount} label={d.mount} ltr percent={d.usagePercent} detail={he.system.free(formatBytes(d.freeBytes))} />
      ))}

      <h3 className="sub-head">{he.system.battery}</h3>
      {battery.available && battery.levelPercent !== undefined ? (
        <Meter
          label={battery.charging ? he.system.charging : he.system.onBattery}
          percent={battery.levelPercent}
        />
      ) : (
        <p className="empty-note">{battery.note_he ?? he.system.noBattery}</p>
      )}

      {services.length > 0 && (
        <>
          <h3 className="sub-head">{he.system.services}</h3>
          <ul className="service-list">
            {services.map((s) => (
              <ServiceRow key={s.service} service={s} />
            ))}
          </ul>
        </>
      )}

      <p className="system-foot">
        {he.system.uptime}: {formatUptime(status.uptimeSec)} · {he.system.lastUpdate}{' '}
        <span dir="ltr">{formatShortTime(status.timestamp)}</span>
      </p>
    </div>
  );
}
