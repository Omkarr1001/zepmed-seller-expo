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

const INTERNAL_MARKERS = /\s*\[RX_CUSTOMER_AUTHORIZED\]\s*/gi;

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
  if (lines.some((line) => line.label === label && line.value === text)) return;
  lines.push({ label, value: text });
}

function splitBlob(blob: string): string[] {
  return blob
    .split(/\n+|\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBlob(blob: string, lines: CustomerRxLine[]) {
  const normalized = String(blob)
    .replace(INTERNAL_MARKERS, '\n')
    .replace(/\s*\/\s*$/g, '');
  const leftover: string[] = [];
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

/** Customer extra Rx fields (qty / doses / other notes) stored on the order. */
export function parseCustomerRxDetails(source?: CustomerRxSource | null): CustomerRxLine[] {
  if (!source) return [];
  const lines: CustomerRxLine[] = [];
  pushUnique(lines, 'Qty', source.qty ?? source.extra_qty ?? source.quantity_notes);
  pushUnique(lines, 'Doses', source.doses ?? source.dosage);
  pushUnique(lines, 'Requested supply', source.requested_supply);
  pushUnique(lines, 'Other notes', source.other_notes ?? source.other_instructions);

  const blobs = [
    source.extra_rx_details,
    source.extra_details,
    source.customer_notes,
    source.notes,
  ];
  for (const blob of blobs) {
    if (blob) parseBlob(String(blob), lines);
  }

  return lines;
}

export function hasCustomerRxDetails(source?: CustomerRxSource | null): boolean {
  return parseCustomerRxDetails(source).length > 0;
}

export function customerRxDetailsText(source?: CustomerRxSource | null): string {
  return parseCustomerRxDetails(source).map((line) => `${line.label}: ${line.value}`).join('\n');
}
