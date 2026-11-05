export type CustomerRxSource = {
  notes?: string | null;
  customer_notes?: string | null;
  extra_details?: string | null;
  extra_rx_details?: string | null;
  requested_supply?: string | null;
  doses?: string | null;
  dosage?: string | null;
  other_notes?: string | null;
  other_instructions?: string | null;
  qty?: string | number | null;
  extra_qty?: string | number | null;
  quantity_notes?: string | null;
  message?: string | null;
};

export type CustomerRxLine = { label: string; value: string };

type RxSelection = { line_number?: number; medicine_name?: string; mode?: string; amount?: number | null };

const INTERNAL_MARKERS = /\s*\[RX_CUSTOMER_AUTHORIZED\]\s*/gi;
const SELECTIONS_BLOCK = /\[RX_SELECTIONS\]([\s\S]*?)\[\/RX_SELECTIONS\]/gi;
const BOILERPLATE = [
  /customer must review the prepared cart[\s\S]*/i,
  /customer authorises the pharmacy[\s\S]*/i,
  /\[rx_customer_authorized\][\s\S]*/i,
];

const LABEL_ALIASES: Array<{ match: RegExp; label: string }> = [
  { match: /^(requested\s*supply|supply)\s*:?\s*/i, label: 'Requested supply' },
  { match: /^(qty|quantity|extra\s*qty)\s*:?\s*/i, label: 'Qty' },
  { match: /^(doses?|dosage)\s*:?\s*/i, label: 'Doses' },
  { match: /^(other\s*instructions?\s*(?:\/\s*exclusions?)?|exclusions?|other\s*notes?)\s*:?\s*/i, label: 'Other notes' },
];

function cleanText(value?: string | number | null): string {
  if (value == null) return '';
  return String(value)
    .replace(INTERNAL_MARKERS, ' ')
    .replace(/\s*\/\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushUnique(lines: CustomerRxLine[], label: string, value?: string | number | null) {
  const text = cleanText(value);
  if (!text) return;
  if (/[\[\]{}"line_number"]/.test(text) && /line_number|medicine_name/.test(text)) return;
  if (lines.some((line) => line.label === label && line.value === text)) return;
  lines.push({ label, value: text });
}

function modeLabel(mode?: string, amount?: number | null): string {
  const kind = String(mode || '').toLowerCase();
  if (kind === 'skip') return 'Skip / excluded';
  if (amount == null || Number.isNaN(Number(amount))) return kind || 'as prescribed';
  if (kind === 'units' || kind === 'unit') return `${amount} unit${Number(amount) === 1 ? '' : 's'}`;
  if (kind === 'doses' || kind === 'dose') return `${amount} dose${Number(amount) === 1 ? '' : 's'}`;
  if (kind === 'days' || kind === 'day') return `${amount} day${Number(amount) === 1 ? '' : 's'}`;
  return `${amount} ${kind}`.trim();
}

export function parseRxSelections(blob?: string | null): CustomerRxLine[] {
  if (!blob) return [];
  const lines: CustomerRxLine[] = [];
  const matches = String(blob).matchAll(new RegExp(SELECTIONS_BLOCK.source, 'gi'));
  for (const match of matches) {
    try {
      const rows = JSON.parse(match[1]) as RxSelection[];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const name = cleanText(row.medicine_name) || `Medicine ${row.line_number ?? ''}`.trim();
        if (!name) continue;
        const mode = String(row.mode || '').toLowerCase();
        pushUnique(lines, mode === 'skip' ? 'Skip' : 'Include', `${name} — ${modeLabel(row.mode, row.amount)}`);
      }
    } catch {
      // Ignore malformed selection JSON.
    }
  }
  return lines;
}

function stripInternal(blob: string): string {
  let text = String(blob).replace(new RegExp(SELECTIONS_BLOCK.source, 'gi'), '\n');
  for (const pattern of BOILERPLATE) text = text.replace(pattern, '\n');
  return text.replace(INTERNAL_MARKERS, '\n');
}

function splitBlob(blob: string): string[] {
  return blob
    .split(/\n+|\s+\/\s+(?=(?:requested\s*supply|supply|qty|quantity|doses?|dosage|other\s*instructions?(?:\s*\/\s*exclusions?)?|other\s*notes?)\s*:)/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBlob(blob: string, lines: CustomerRxLine[]) {
  const leftover: string[] = [];
  for (const raw of splitBlob(stripInternal(blob))) {
    const part = raw.replace(/\s+/g, ' ').trim();
    if (!part) continue;
    let matched = false;
    for (const alias of LABEL_ALIASES) {
      if (!alias.match.test(part)) continue;
      const value = part.replace(alias.match, '').trim();
      if (value && !/^none specified\b/i.test(value)) {
        const skipNames = lines.filter((line) => line.label === 'Skip').map((line) => line.value.split(' — ')[0].toLowerCase());
        if (alias.label === 'Other notes' && skipNames.some((name) => value.toLowerCase() === name.toLowerCase())) {
          matched = true;
          break;
        }
        pushUnique(lines, alias.label, value);
      }
      matched = true;
      break;
    }
    if (!matched) leftover.push(part);
  }
  if (leftover.length) {
    const rest = leftover
      .filter((part) => !/^none specified\b/i.test(part) && !/^(other instructions|exclusions)$/i.test(part))
      .filter((part) => !/line_number|medicine_name|RX_SELECTIONS/i.test(part))
      .join(' · ');
    if (rest) pushUnique(lines, 'Other notes', rest);
  }
}

/** Customer extra Rx fields (qty / doses / other notes) stored on the order. */
export function parseCustomerRxDetails(source?: CustomerRxSource | null): CustomerRxLine[] {
  if (!source) return [];
  const lines: CustomerRxLine[] = [];
  const blobs = [
    source.extra_rx_details,
    source.extra_details,
    source.customer_notes,
    source.notes,
  ].filter(Boolean).map(String);

  for (const blob of blobs) {
    for (const line of parseRxSelections(blob)) pushUnique(lines, line.label, line.value);
  }

  pushUnique(lines, 'Qty', source.qty ?? source.extra_qty ?? source.quantity_notes);
  pushUnique(lines, 'Doses', source.doses ?? source.dosage);
  pushUnique(lines, 'Requested supply', source.requested_supply);
  pushUnique(lines, 'Other notes', source.other_notes ?? source.other_instructions);

  for (const blob of blobs) parseBlob(blob, lines);

  return lines;
}

export function hasCustomerRxDetails(source?: CustomerRxSource | null): boolean {
  return parseCustomerRxDetails(source).length > 0;
}

export function customerRxDetailsText(source?: CustomerRxSource | null): string {
  return parseCustomerRxDetails(source).map((line) => `${line.label}: ${line.value}`).join('\n');
}
