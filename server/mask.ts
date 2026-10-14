// Sensitive values (SSNs, IP PINs, e-file PINs, bank and foreign account numbers) are masked in
// everything the server sends. Seeing one unmasked is a separate, logged request.

const keepLast4 = (s: string) => { let n = 0; return s.split('').reverse().map(ch => (/\d/.test(ch) && n++ >= 4 ? '•' : ch)).reverse().join(''); };

export function buildMasker(P: any) {
  const literals = new Set<string>();
  for (const p of P.household.people) { if (p.ssn) literals.add(p.ssn); if (p.ip_pin) literals.add(p.ip_pin); }
  const bank = P.household.bank_account_for_refund_or_payment;
  if (bank) { literals.add(bank.routing); literals.add(bank.account); }
  for (const d of P.prior_years.return_2024.dependents ?? []) literals.add(d.ssn);
  for (const e of P.extracted_values) if (['ssn', 'account_number'].includes(e.value_type) || e.field === 'ip_pin') { literals.add(String(e.value)); if (e.text_as_read) literals.add(e.text_as_read); }
  const sorted = [...literals].filter(x => x && x.length >= 5).sort((a, b) => b.length - a.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literalRe = new RegExp(sorted.map(esc).join('|'), 'g');
  const patterns = [
    /\b\d{3}-\d{2}-\d{4}\b/g,                 // any SSN-shaped number
    /\b[A-Z]{2}\d{2}(?: \d{4}){4,7}\b/g,       // IBAN with spaces
    /\b(PIN )(\d{5,6})\b/g,                    // e-file signature PINs in timeline text
  ];
  return function mask(text: string): string {
    let out = text.replace(literalRe, keepLast4);
    out = out.replace(patterns[0], keepLast4).replace(patterns[1], keepLast4).replace(patterns[2], (_m, a, b) => a + keepLast4(b));
    return out;
  };
}

// Run directly to check: node server/mask.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const ok = (v: unknown, m: string) => { if (!v) throw new Error('mask check failed: ' + m); };
  const raw = readFileSync(new URL('../data/okafor_lindqvist_2025_packet.json', import.meta.url), 'utf8');
  const P = JSON.parse(raw);
  const mask = buildMasker(P);
  const m = mask(raw);
  ok(!m.includes('666-41-2287') && m.includes('•••-••-2287'), 'taxpayer SSN masked, last 4 kept');
  ok(!m.includes('666-74-3390') && !m.includes('666-74-3309'), 'both versions of Theo SSN masked');
  ok(!m.includes('482915'), 'IP PIN masked');
  ok(!m.includes('4483019276') && !m.includes('990000017'), 'bank account and routing masked');
  ok(!m.includes('SE45 8000 0000 0412 7783 9901'), 'IBAN masked');
  ok(!m.includes('PIN 41207') && !m.includes('PIN 88310'), 'e-file PINs masked');
  ok(m.includes('82-4471903'), 'employer EINs are not personal and stay visible');
  JSON.parse(m); // still valid JSON
  console.log('mask: ok');
}
