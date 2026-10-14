import { useEffect, useRef } from 'react';
import { AREAS, areaOf, fmt, isLot, isWorksheet, labelMaker, type Line, type Graph } from '../shared/packet.ts';
import { StatusMark } from './StatusMark.tsx';
import type { Workpaper } from './data.ts';
import { SignoffPanel } from './Actions.tsx';

export const BOX_NAMES: Record<string, string> = {
  A: 'Short-term, basis reported', B: 'Short-term, basis not reported', D: 'Long-term, basis reported',
  E: 'Long-term, basis not reported', F: 'Long-term, no Form 1099-B', H: 'Digital assets, short-term', K: 'Digital assets, long-term',
};

export type Row = { area: string; key: string; depth: number };
export type AreaInfo = { area: string; rows: Row[]; worksheet: Row[]; open: number; reviewable: number; verified: number };

export function buildAreas(g: Graph, w: Workpaper): AreaInfo[] {
  const L = g.lines.v3;
  const all = g.P.return_versions.find((v: any) => v.version === 'v3').lines as Line[];
  return [...AREAS.map(a => a[0]), 'Other'].map(area => {
    const rows: Row[] = [], worksheet: Row[] = [];
    const open = new Set<string>();
    for (const l of all) {
      if (isLot(l.key) || areaOf(l.key) !== area) continue;
      const rollup = /^F8949\.[A-Z]\.total$/.test(l.key);
      (rollup || !isWorksheet(l, L) || w.byLine![l.key]?.length ? rows : worksheet).push({ area, key: l.key, depth: 0 });
      for (const f of w.byLine![l.key] ?? []) open.add(f.id);
      if (rollup) for (const k of l.inputs) if (w.byLine![k]?.length) {
        rows.push({ area, key: k, depth: 1 });
        for (const f of w.byLine![k]) open.add(f.id);
      }
    }
    const reviewable = rows.filter(r => !r.depth);
    return { area, rows, worksheet, open: open.size, reviewable: reviewable.length, verified: reviewable.filter(r => w.verified!.has(r.key)).length };
  }).filter(a => a.rows.length + a.worksheet.length);
}

// Rows the keyboard walks: only what is on screen.
export const visibleRows = (areas: AreaInfo[], open: Set<string>, showWs: Set<string>) =>
  areas.flatMap(a => (open.has(a.area) ? [...a.rows, ...(showWs.has(a.area) ? a.worksheet : [])] : []));

type Props = { g: Graph; w: Workpaper; areas: AreaInfo[]; open: Set<string>; showWs: Set<string>; toggle: (a: string) => void; toggleWs: (a: string) => void; selected?: string; cursorKey?: string; onSelect: (k: string) => void };

export function Outline({ g, w, areas, open, showWs, toggle, toggleWs, selected, cursorKey, onSelect }: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' }); }, [cursorKey]);
  const label = labelMaker(Object.values(g.lines.v3));
  const row = (r: Row) => {
    const l = g.line(r.key)!;
    const own = w.own!(r.key), affected = w.affectedBy!(r.key);
    const box = l.key.match(/^F8949\.([A-Z])\.total$/)?.[1];
    return (
      <button key={r.key} className={`outline-row depth-${r.depth}${selected === r.key ? ' is-selected' : ''}`} data-cursor={cursorKey === r.key} onClick={() => onSelect(r.key)}>
        {own !== 'Unverified' ? <StatusMark status={own} /> : affected ? <span className="affected" title={`Affected by ${affected} open ${affected === 1 ? 'item' : 'items'} upstream`} /> : <StatusMark status="Unverified" />}
        <span className="outline-label">{box ? <>Form 8949 box {box}, {BOX_NAMES[box].toLowerCase()}<span className="muted"> ({l.inputs.length} {l.inputs.length === 1 ? 'sale' : 'sales'})</span></> : r.depth ? lotLabel(l) : label(l)}</span>
        <span className="num">{fmt(l.value, isLot(l.key))}</span>
      </button>
    );
  };
  return (
    <nav className="outline" ref={ref} aria-label="Return outline">
      {areas.map(a => (
        <section key={a.area} className="outline-section">
          <button className="outline-area" aria-expanded={open.has(a.area)} onClick={() => toggle(a.area)}>
            <span className="chev" aria-hidden>{open.has(a.area) ? '−' : '+'}</span>
            <span className="area-name">{a.area}</span>
            <span className={`area-open${a.open ? ' has-open' : ''}`}>{a.open ? `${a.open} open` : 'none open'}</span>
            <span className="area-verified">{a.verified}/{a.reviewable} verified</span>
          </button>
          {open.has(a.area) && (
            <div className="outline-lines">
              {a.rows.map(row)}
              {a.worksheet.length > 0 && <button className="ws-toggle" onClick={() => toggleWs(a.area)}>{showWs.has(a.area) ? 'Hide worksheet lines' : `Show worksheet lines (${a.worksheet.length})`}</button>}
              {showWs.has(a.area) && <div className="worksheet">{a.worksheet.map(row)}</div>}
              <SignoffPanel g={g} w={w} scope={`area:${a.area}`} />
            </div>
          )}
        </section>
      ))}
    </nav>
  );
}

export const lotLabel = (l: Line) => {
  const lot = l.key.split('.').pop();
  return `${l.label.replace(/ \(acquired.*$/, '').replace(/ Inc\b| Corp\b/g, '')}, lot ${lot}`;
};
