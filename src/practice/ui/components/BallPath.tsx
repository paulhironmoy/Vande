/**
 * After contact: the ball's actual path over the ground and the fielder responsible (the physics' own samples and
 * outcome), as a small map beside the result. Nothing is drawn for a leave or a miss.
 */
import type { DeliveryRecord, DeliveryResult } from '@/contracts';
import { useKit } from '../context';

export function BallPath({
  result,
  record,
  size = 72,
}: {
  result: DeliveryResult;
  record: DeliveryRecord;
  size?: number;
}) {
  const { ground: g } = useKit();
  const t0 = result.contact.t;
  if (t0 === null || !result.swing || result.contact.kind === 'leave' || result.contact.kind === 'miss') return null;
  const mirror = record.handedness === 'left' ? -1 : 1;
  const pts = result.ball.filter((b) => b.t >= t0).map((b) => [mirror * b.p.x, b.p.z] as const);
  if (pts.length < 2) return null;
  const R = g.boundaryR + 3;
  const step = Math.max(1, Math.floor(pts.length / 60));
  const d = pts
    .filter((_, i) => i % step === 0 || i === pts.length - 1)
    .map(([x, z], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${z.toFixed(1)}`)
    .join('');
  const fielder = result.outcome.fielderId
    ? record.field.fielders.find((f) => f.id === result.outcome.fielderId)
    : null;
  const end = pts[pts.length - 1];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
      data-testid="practice-ball-path"
    >
      <circle cx={0} cy={0} r={g.boundaryR} fill="#10261d" stroke="rgba(243,239,231,0.55)" strokeWidth={2} />
      <circle
        cx={0}
        cy={0}
        r={g.ringR}
        fill="none"
        stroke="rgba(243,239,231,0.3)"
        strokeWidth={1.4}
        strokeDasharray="4 4"
      />
      <rect x={-2} y={-g.pitchHalf} width={4} height={2 * g.pitchHalf} fill="#b48c5a" />
      {record.field.fielders.map((f) => (
        <circle
          key={f.id}
          cx={mirror * f.x}
          cy={f.z}
          r={3}
          fill={f.id === fielder?.id ? '#f2ad41' : 'rgba(243,239,231,0.55)'}
        />
      ))}
      <path d={d} fill="none" stroke="#f3efe7" strokeWidth={2.4} strokeLinecap="round" />
      <circle cx={end[0]} cy={end[1]} r={3.6} fill="#52d3f2" />
      {fielder && (
        <rect
          x={mirror * fielder.x - 5}
          y={fielder.z - 5}
          width={10}
          height={10}
          fill="none"
          stroke="#f2ad41"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
