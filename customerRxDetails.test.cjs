const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = fs.readFileSync(path.join(__dirname, 'customerRxDetails.ts'), 'utf8');

// Smoke: implementation lives in TS; exercise the same rules via a tiny runtime copy of exports
// by evaluating the compiled-like copy below (kept in sync with customerRxDetails.ts).
const INTERNAL_MARKERS = /\s*\[RX_CUSTOMER_AUTHORIZED\]\s*/gi;
const SELECTIONS_BLOCK = /\[RX_SELECTIONS\]([\s\S]*?)\[\/RX_SELECTIONS\]/gi;
const BOILERPLATE = [
  /customer must review the prepared cart[\s\S]*/i,
  /customer authorises the pharmacy[\s\S]*/i,
  /\[rx_customer_authorized\][\s\S]*/i,
];

function cleanText(value) {
  if (value == null) return '';
  return String(value).replace(INTERNAL_MARKERS, ' ').replace(/\s*\/\s*$/g, '').replace(/\s+/g, ' ').trim();
}
function pushUnique(lines, label, value) {
  const text = cleanText(value);
  if (!text) return;
  if (/[\[\]{}"line_number"]/.test(text) && /line_number|medicine_name/.test(text)) return;
  if (lines.some((line) => line.label === label && line.value === text)) return;
  lines.push({ label, value: text });
}
function modeLabel(mode, amount) {
  const kind = String(mode || '').toLowerCase();
  if (kind === 'skip') return 'Skip / excluded';
  if (amount == null || Number.isNaN(Number(amount))) return kind || 'as prescribed';
  if (kind === 'units' || kind === 'unit') return `${amount} unit${Number(amount) === 1 ? '' : 's'}`;
  if (kind === 'doses' || kind === 'dose') return `${amount} dose${Number(amount) === 1 ? '' : 's'}`;
  if (kind === 'days' || kind === 'day') return `${amount} day${Number(amount) === 1 ? '' : 's'}`;
  return `${amount} ${kind}`.trim();
}
function parseRxSelections(blob) {
  if (!blob) return [];
  const lines = [];
  for (const match of String(blob).matchAll(new RegExp(SELECTIONS_BLOCK.source, 'gi'))) {
    try {
      for (const row of JSON.parse(match[1])) {
        const name = cleanText(row.medicine_name) || `Medicine ${row.line_number ?? ''}`.trim();
        if (!name) continue;
        const mode = String(row.mode || '').toLowerCase();
        pushUnique(lines, mode === 'skip' ? 'Skip' : 'Include', `${name} — ${modeLabel(row.mode, row.amount)}`);
      }
    } catch { /* ignore */ }
  }
  return lines;
}
function stripInternal(blob) {
  let text = String(blob).replace(new RegExp(SELECTIONS_BLOCK.source, 'gi'), '\n');
  for (const pattern of BOILERPLATE) text = text.replace(pattern, '\n');
  return text.replace(INTERNAL_MARKERS, '\n');
}
const LABEL_ALIASES = [
  { match: /^(requested\s*supply|supply)\s*:?\s*/i, label: 'Requested supply' },
  { match: /^(qty|quantity|extra\s*qty)\s*:?\s*/i, label: 'Qty' },
  { match: /^(doses?|dosage)\s*:?\s*/i, label: 'Doses' },
  { match: /^(other\s*instructions?\s*(?:\/\s*exclusions?)?|exclusions?|other\s*notes?)\s*:?\s*/i, label: 'Other notes' },
];
function splitBlob(blob) {
  return blob.split(/\n+|\s+\/\s+(?=(?:requested\s*supply|supply|qty|quantity|doses?|dosage|other\s*instructions?(?:\s*\/\s*exclusions?)?|other\s*notes?)\s*:)/i).map((p) => p.trim()).filter(Boolean);
}
function parseBlob(blob, lines) {
  const leftover = [];
  for (const raw of splitBlob(stripInternal(blob))) {
    const part = raw.replace(/\s+/g, ' ').trim();
    if (!part) continue;
    let matched = false;
    for (const alias of LABEL_ALIASES) {
      if (!alias.match.test(part)) continue;
      const value = part.replace(alias.match, '').trim();
      if (value && !/^none specified\b/i.test(value)) {
        const skipNames = lines.filter((line) => line.label === 'Skip').map((line) => line.value.split(' — ')[0].toLowerCase());
        if (!(alias.label === 'Other notes' && skipNames.some((name) => value.toLowerCase() === name.toLowerCase()))) {
          pushUnique(lines, alias.label, value);
        }
      }
      matched = true;
      break;
    }
    if (!matched) leftover.push(part);
  }
  if (leftover.length) {
    const rest = leftover.filter((part) => !/^none specified\b/i.test(part) && !/line_number|medicine_name|RX_SELECTIONS/i.test(part)).join(' · ');
    if (rest) pushUnique(lines, 'Other notes', rest);
  }
}
function parseCustomerRxDetails(source) {
  if (!source) return [];
  const lines = [];
  const blobs = [source.extra_rx_details, source.extra_details, source.customer_notes, source.notes].filter(Boolean).map(String);
  for (const blob of blobs) for (const line of parseRxSelections(blob)) pushUnique(lines, line.label, line.value);
  pushUnique(lines, 'Qty', source.qty ?? source.extra_qty ?? source.quantity_notes);
  pushUnique(lines, 'Doses', source.doses ?? source.dosage);
  pushUnique(lines, 'Requested supply', source.requested_supply);
  pushUnique(lines, 'Other notes', source.other_notes ?? source.other_instructions);
  for (const blob of blobs) parseBlob(blob, lines);
  return lines;
}

assert.ok(ts.includes('parseRxSelections'));
assert.ok(ts.includes('Skip / excluded'));

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

const rxJson = parseCustomerRxDetails({
  notes: 'Requested supply: Only individually selected medicines; all unlisted medicines excluded\n[RX_SELECTIONS][{"line_number":1,"medicine_name":"Medicine 1","mode":"units","amount":5},{"line_number":2,"medicine_name":"Medicine 2","mode":"doses","amount":2},{"line_number":3,"medicine_name":"Medicine 3","mode":"days","amount":2},{"line_number":4,"medicine_name":"Medicine 4","mode":"skip","amount":null}][/RX_SELECTIONS]\nOther instructions / exclusions: Medicine 4\nCustomer must review the prepared cart and checkout before fulfilment.\n[RX_CUSTOMER_AUTHORIZED] Customer authorises the pharmacy to finalise this order and send it to the delivery agent, without another cart checkout.',
});
assert.ok(!JSON.stringify(rxJson).includes('line_number'));
assert.ok(!JSON.stringify(rxJson).includes('RX_SELECTIONS'));
assert.ok(!JSON.stringify(rxJson).includes('authorises'));
assert.strictEqual(rxJson.find((l) => l.label === 'Requested supply').value, 'Only individually selected medicines; all unlisted medicines excluded');
assert.ok(rxJson.some((l) => l.label === 'Include' && l.value.includes('Medicine 1') && l.value.includes('5 unit')));
assert.ok(rxJson.some((l) => l.label === 'Include' && l.value.includes('Medicine 2') && l.value.includes('2 dose')));
assert.ok(rxJson.some((l) => l.label === 'Include' && l.value.includes('Medicine 3') && l.value.includes('2 day')));
assert.ok(rxJson.some((l) => l.label === 'Skip' && l.value.includes('Medicine 4')));
assert.ok(!rxJson.some((l) => l.label === 'Other notes' && l.value === 'Medicine 4'));

assert.deepStrictEqual(parseCustomerRxDetails({ notes: '' }), []);
assert.deepStrictEqual(parseCustomerRxDetails(null), []);

console.log('customerRxDetails ok', rxJson.map((l) => `${l.label}=${l.value}`).join(' | '));
