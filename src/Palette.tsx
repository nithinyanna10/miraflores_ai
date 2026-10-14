import { useMemo, useState } from 'react';
import { fmt, type Graph } from '../shared/packet.ts';

type Item = { kind: string; ref: string; text: string; hint: string };

export function Palette({ g, onClose, onPick }: { g: Graph; onClose: () => void; onPick: (kind: string, ref: string) => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const all = useMemo<Item[]>(() => [
    ...Object.values(g.lines.v3).map(l => ({ kind: 'line', ref: l.key, text: `${l.key} ${l.label}`, hint: fmt(l.value) })),
    ...Object.values(g.docs).map((d: any) => ({ kind: 'doc', ref: d.id, text: `${d.id} ${d.title}`, hint: 'Document' })),
    ...Object.values(g.evs).map(e => ({ kind: 'ev', ref: e.id, text: `${e.id} ${e.document_id} ${e.label}`, hint: fmt(e.value) })),
    ...g.P.client.questionnaire.map((x: any) => ({ kind: 'qa', ref: x.id, text: `${x.id} ${x.question} ${x.answer}`, hint: 'Questionnaire' })),
    ...g.P.client.messages.map((x: any) => ({ kind: 'msg', ref: x.id, text: `${x.id} ${x.from} ${x.text}`, hint: 'Message' })),
  ], [g]);
  const hits = useMemo(() => {
    const ts = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!ts.length) return all.filter(x => x.kind === 'line').slice(0, 30);
    return all.filter(x => { const t = x.text.toLowerCase(); return ts.every(s => t.includes(s)); }).slice(0, 50);
  }, [q, all]);
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Search" onMouseDown={e => e.stopPropagation()}>
        <input autoFocus value={q} placeholder="Line, document, ev-id, question, message" aria-label="Search"
          onChange={e => { setQ(e.target.value); setI(0); }}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(hits.length - 1, x + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)); }
            else if (e.key === 'Enter' && hits[i]) onPick(hits[i].kind, hits[i].ref);
          }} />
        <ul>
          {hits.map((h, j) => (
            <li key={h.kind + h.ref} className={j === i ? 'is-active' : ''} onMouseEnter={() => setI(j)} onClick={() => onPick(h.kind, h.ref)}>
              <span className="ref">{h.ref}</span><span className="palette-text">{h.text.slice(h.ref.length + 1)}</span><span className="num muted">{h.hint}</span>
            </li>
          ))}
          {!hits.length && <li className="muted">Nothing matches. Try a line key like F1040.11, a document like D09, or a word from a label.</li>}
        </ul>
      </div>
    </div>
  );
}
