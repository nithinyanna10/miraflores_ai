import { useEffect, useRef } from 'react';
import { AREAS, areaOf, fmt, isLot, shown, type Line, type Graph } from '../shared/packet.ts';
import { StatusMark } from './StatusMark.tsx';
import type { Workpaper } from './data.ts';

export const BOX_NAMES: Record<string, string> = {
  A: 'Short-term, basis reported', B: 'Short-term, basis not reported', D: 'Long-term, basis reported',
  E: 'Long-term, basis not reported', F: 'Long-term, no Form 1099-B', H: 'Digital assets short-term, basis not reported', K: 'Digital assets long-term, basis not reported',
};

// Visible outline rows in order: area headings are not rows; lots appear only as exceptions under their box.
export function outlineRows(g: Graph, w: Workpaper): { area: string; key: string; depth: number }[] {
  const rows: { area: string; key: string; depth: number }[] = [];
  const all = g.P.return_versions.find((v: any) => v.version === 'v3').lines as Line[];
  for (const [area] of [...AREAS, ['Other']] as [string][]) {
    for (const l of all) {
      if (isLot(l.key) || areaOf(l.key) !== area) continue;
      rows.push({ area, key: l.key, depth: 0 });
      if (/^F8949\.[A-Z]\.total$/.test(l.key)) for (const k of l.inputs) if (w.byLine![k]?.length) rows.push({ area, key: k, depth: 1 });
    }
  }
  return rows;
}

export function Outline({ g, w, rows, selected, cursor, onSelect }: { g: Graph; w: Workpaper; rows: ReturnType<typeof outlineRows>; selected?: string; cursor: number; onSelect: (k: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  let area = '';
  return (
    <nav className="outline" ref={ref} aria-label="Return outline">
      {rows.map((r, i) => {
        const l = g.line(r.key)!;
        const heading = r.area !== area ? (area = r.area) : null;
        const [st, showInherited] = shown(w.own!(r.key), w.inherited!(r.key));
        const box = l.key.match(/^F8949\.([A-Z])\.total$/)?.[1];
        return (
          <div key={r.key}>
            {heading && <h2 className="outline-area">{heading}</h2>}
            <button
              className={`outline-row depth-${r.depth}${selected === r.key ? ' is-selected' : ''}`}
              data-cursor={i === cursor}
              onClick={() => onSelect(r.key)}
              title={`${l.key}: ${l.label}`}
            >
              <StatusMark status={st} inherited={showInherited} />
              <span className="outline-label">
                {box ? <>Form 8949 box {box}: {BOX_NAMES[box] ?? ''} <span className="muted">{l.inputs.length} {l.inputs.length === 1 ? 'sale' : 'sales'}</span></> : r.depth ? shortLot(l) : l.label}
              </span>
              <span className="num">{fmt(l.value, isLot(l.key))}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

const shortLot = (l: Line) => l.label.replace(/ \(acquired.*$/, '') + ` (${l.key.split('.').pop()})`;
