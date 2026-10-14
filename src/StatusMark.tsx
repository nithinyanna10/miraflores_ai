import type { Status } from '../shared/packet.ts';

// Every state has a shape as well as a colour. `inherited` draws the outline only.
export function StatusMark({ status, inherited = false, size = 12 }: { status: Status; inherited?: boolean; size?: number }) {
  const s = size, c = s / 2;
  const cls = `mark mark-${status.replace(' ', '-').toLowerCase()}${inherited ? ' mark-inherited' : ''}`;
  let shape;
  switch (status) {
    case 'Blocked': // square with a break through it
      shape = <><rect x="1" y="1" width={s - 2} height={s - 2} rx="1" /><path d={`M${s * 0.3} ${s * 0.3} L${s * 0.7} ${s * 0.7} M${s * 0.7} ${s * 0.3} L${s * 0.3} ${s * 0.7}`} className="mark-glyph" /></>;
      break;
    case 'Question open': // diamond
      shape = <path d={`M${c} 1 L${s - 1} ${c} L${c} ${s - 1} L1 ${c} Z`} />;
      break;
    case 'Verified': case 'Signed':
      shape = <><circle cx={c} cy={c} r={c - 1} /><path d={`M${s * 0.28} ${s * 0.52} L${s * 0.45} ${s * 0.68} L${s * 0.72} ${s * 0.34}`} className="mark-glyph" /></>;
      break;
    default: // Unverified: hollow circle
      shape = <circle cx={c} cy={c} r={c - 1.5} />;
  }
  return <svg className={cls} width={s} height={s} viewBox={`0 0 ${s} ${s}`} role="img" aria-label={inherited ? `${status} upstream` : status}><title>{inherited ? `${status} upstream` : status}</title>{shape}</svg>;
}
