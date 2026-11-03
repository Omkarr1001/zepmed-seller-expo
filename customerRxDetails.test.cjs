const assert = require('assert');

const INTERNAL_MARKERS = /\s*\[RX_CUSTOMER_AUTHORIZED\]\s*/gi;
const LABEL_ALIASES = [
  { match: /^(requested\s*supply|supply)\s*:?\s*/i, label: 'Requested supply' },
  { match: /^(qty|quantity|extra\s*qty)\s*:?\s*/i, label: 'Qty' },
  { match: /^(doses?|dosage)\s*:?\s*/i, label: 'Doses' },
  { match: /^(other\s*instructions?\s*(?:\/\s*exclusions?)?|exclusions?|other\s*notes?)\s*:?\s*/i, label: 'Other notes' },
];

function cleanText(value) {
  if (value == null) return '';
  return String(value)
    .replace(INTERNAL_MARKERS, ' ')
    .replace(/\s*\/\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushUnique(lines, label, value) {
  const text = cleanText(value);
  if (!text) return;
  if (lines.some((line) => line.label === label && line.value === text)) return;
  lines.push({ label, value: text });
}

function splitBlob(blob) {
  return blob.split(/\n+|\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
}

function parseBlob(blob, lines) {
  const normalized = String(blob)
    .replace(INTERNAL_MARKERS, '\n')
    .replace(/\s*\/\s*$/g, '');
  const leftover = [];
  for (const raw of splitBlob(normalized)) {
    const part = raw.replace(/\s+/g, ' ').trim();
    if (!part) continue;
    let matched = false;
    for (const alias of LABEL_ALIASES) {
      if (!alias.match.test(part)) continue;
      const value = part.replace(alias.match, '').trim();
      if (value && !/^none specified\b/i.test(value)) pushUnique(lines, alias.label, value);
      matched = true;
      break;
    }
    if (!matched) leftover.push(part);
  }
  if (leftover.length) {
    const rest = leftover
      .filter((part) => !/^none specified\b/i.test(part) && !/^(other instructions|exclusions)$/i.test(part))
      .join(' · ');
    if (rest) pushUnique(lines, 'Other notes', rest);
  }
}

function parseCustomerRxDetails(source) {
  if (!source) return [];
  const lines = [];
  pushUnique(lines, 'Qty', source.qty ?? source.extra_qty ?? source.quantity_notes);
  pushUnique(lines, 'Doses', source.doses ?? source.dosage);
  pushUnique(lines, 'Requested supply', source.requested_supply);
  pushUnique(lines, 'Other notes', source.other_notes ?? source.other_instructions);
  for (const blob of [source.extra_rx_details, source.extra_details, source.customer_notes, source.notes]) {
    if (blob) parseBlob(String(blob), lines);
  }
  return lines;
}

const live = parseCustomerRxDetails({
  notes: 'Requested supply: As prescribed / Other instructions / exclusions: None specified / [RX_CUSTOMER_AUTHORIZED]',
});
assert.deepStrictEqual(live, [{ label: 'Requested supply', value: 'As prescribed' }]);
assert.ok(!/RX_CUSTOMER_AUTHORIZED/.test(JSON.stringify(live)));

const filled = parseCustomerRxDetails({
  notes: 'Qty: 2 strips\nDoses: 1-0-1 after food\nOther notes: no substitutions',
});
assert.strictEqual(filled.find((l) => l.label === 'Qty').value, '2 strips');
assert.strictEqual(filled.find((l) => l.label === 'Doses').value, '1-0-1 after food');
assert.strictEqual(filled.find((l) => l.label === 'Other notes').value, 'no substitutions');

const structured = parseCustomerRxDetails({ qty: 10, doses: '1-1-1', other_notes: 'keep refrigerated' });
assert.deepStrictEqual(structured, [
  { label: 'Qty', value: '10' },
  { label: 'Doses', value: '1-1-1' },
  { label: 'Other notes', value: 'keep refrigerated' },
]);

assert.deepStrictEqual(parseCustomerRxDetails({ notes: '' }), []);
assert.deepStrictEqual(parseCustomerRxDetails(null), []);

console.log('customerRxDetails ok', live.map((l) => `${l.label}=${l.value}`).join(' | '));
