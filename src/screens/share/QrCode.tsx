import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { MARK } from '@/ui';
import s from './QrCode.module.css';

/** QR code for a link (uqr, MIT, loaded only when shown). Dark modules on white with the mark in the centre. */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label?: string }) {
  const { t } = useT();
  const [modules, setModules] = useState<{ path: string; n: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void import('uqr').then(({ encode }) => {
      if (!alive) return;
      const qr = encode(value, { ecc: 'Q', border: 2 });
      const n = qr.size;
      const c = n / 2;
      const hole = Math.ceil(n * 0.11);
      let path = '';
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          if (!qr.data[y][x]) continue;
          if (Math.abs(x + 0.5 - c) < hole && Math.abs(y + 0.5 - c) < hole) continue;
          path += `M${x} ${y}h1v1h-1z`;
        }
      setModules({ path, n });
    });
    return () => {
      alive = false;
    };
  }, [value]);
  if (!modules) return <div className={s.placeholder} style={{ width: size, height: size }} aria-busy="true" />;
  const { n, path } = modules;
  const markSize = n * 0.2;
  return (
    <svg className={s.qr} viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label={label ?? t('invite.qr_label')} shapeRendering="crispEdges" data-testid="invite-qr-code">
      <rect width={n} height={n} fill="#ffffff" />
      <path d={path} fill="#06051f" />
      <g transform={`translate(${n / 2 - markSize / 2} ${n / 2 - markSize / 2}) scale(${markSize / 120})`} shapeRendering="geometricPrecision">
        <path d={MARK.hex} fill="#151143" stroke="#ffaa33" strokeWidth={6} strokeLinejoin="round" />
        <circle cx={MARK.ball.cx} cy={MARK.ball.cy} r={MARK.ball.r} fill="#f5f4ff" />
        <path d={MARK.seam} fill="none" stroke="#0aa6cc" strokeWidth={6.5} strokeLinecap="round" />
      </g>
    </svg>
  );
}
