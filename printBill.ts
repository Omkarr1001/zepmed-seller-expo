import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { printToBluetooth, readSellerPrefs } from './printerNative';

export type PrinterLayout = 'thermal_58' | 'a4_half';

export type BillOrder = {
  order_number?: string | null;
  created_at?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_mobile?: string | null;
  address_line?: string | null;
  city?: string | null;
  pincode?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  total_amount?: number | null;
  delivery_fee?: number | null;
  subtotal?: number | null;
  seller_notes?: string | null;
  pharmacy?: { name?: string | null; address?: string | null; city?: string | null; phone?: string | null } | null;
  items?: Array<{ product_name?: string | null; name?: string | null; quantity?: number | null; price?: number | null; mrp?: number | null; line_total?: number | null }> | null;
  invoice?: {
    invoice_number?: string | null;
    order_number?: string | null;
    invoice_date?: string | null;
    pharmacy_name?: string | null;
    pharmacy_address?: string | null;
    pharmacy_dl_number?: string | null;
    pharmacy_gstin?: string | null;
    pharmacy_phone?: string | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    subtotal?: number | null;
    mrp_subtotal?: number | null;
    delivery_fee?: number | null;
    promo_discount?: number | null;
    shop_order_discount?: number | null;
    wallet_discount?: number | null;
    product_discount_total?: number | null;
    platform_fee_amount?: number | null;
    packaging_charge_amount?: number | null;
    platform_tax_amount?: number | null;
    platform_tax_rate_pct?: number | null;
    platform_tax_name?: string | null;
    total_amount?: number | null;
    cod_collect_amount?: number | null;
    payment_method?: string | null;
    bill_note?: string | null;
    lines?: Array<{ name?: string | null; quantity?: number | null; quantity_label?: string | null; price?: number | null; mrp?: number | null; line_total?: number | null }> | null;
  } | null;
};

export type BillPharmacy = { name?: string | null; address?: string | null; city?: string | null; phone?: string | null; dl_number?: string | null; gstin?: string | null } | null;
export type PrintOptions = { language?: string | null; paper?: string | null; mac?: string | null };

type BillLine = { name: string; qty: string; amount: number };
type BillRow = { text?: string; left?: string; right?: string; center?: boolean; rule?: boolean };

const ESC_COLS = 32;
const LABEL_DOTS = 384;
const LABEL_MM = 48;
const TSPL_COLS = 24;
const TSPL_FONT = '1';
const TSPL_XMUL = 2;
const TSPL_YMUL = 2;
const TSPL_CW = 16;
const TSPL_LH = 28;
const TSPL_LEFT = 0;
const TITLE_XMUL = 3;
const TITLE_YMUL = 3;
const TITLE_CW = 24;
const TITLE_LH = 42;
const BODY_GLYPH_H = 24;
const TITLE_GLYPH_H = 36;
const ITEM_NAME_W = 12;
const ITEM_QTY_W = 4;
const ITEM_AMT_W = 8;

function money(n?: number | null) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyEsc(n?: number | null) {
  return `Rs.${Number(n || 0).toFixed(2)}`;
}

function dash(val?: string | null) {
  const s = String(val ?? '').trim();
  return s || '________';
}

function ascii(text: string) {
  return String(text || '').replace(/₹/g, 'Rs.').replace(/[^\x20-\x7E]/g, ' ');
}

function padLine(left: string, right: string, cols: number) {
  const r = ascii(right).slice(0, cols);
  const maxLeft = Math.max(0, cols - r.length - 1);
  const l = ascii(left).slice(0, maxLeft);
  return `${l}${' '.repeat(Math.max(1, cols - l.length - r.length))}${r}`.slice(0, cols);
}

function wrapText(text: string, width: number) {
  const clean = ascii(text).trim();
  if (!clean) return [] as string[];
  const words = clean.split(/\s+/);
  const out: string[] = [];
  let row = '';
  for (const word of words) {
    if (!row) row = word.slice(0, width);
    else if (`${row} ${word}`.length <= width) row = `${row} ${word}`;
    else {
      out.push(row);
      row = word.slice(0, width);
    }
  }
  if (row) out.push(row);
  return out;
}

function itemCols(name: string, qty: string, amt: string) {
  return `${ascii(name).padEnd(ITEM_NAME_W).slice(0, ITEM_NAME_W)}${ascii(qty).padStart(ITEM_QTY_W).slice(-ITEM_QTY_W)}${ascii(amt).padStart(ITEM_AMT_W).slice(-ITEM_AMT_W)}`;
}

function billLines(order: BillOrder): BillLine[] {
  const inv = order.invoice || {};
  const raw = inv.lines?.length
    ? inv.lines
    : (order.items || []).map((it) => ({
      name: it.product_name || it.name,
      quantity: it.quantity,
      quantity_label: String(it.quantity ?? ''),
      price: it.price,
      line_total: Number(it.price || 0) * Number(it.quantity || 0),
    }));
  return (raw || [])
    .filter((l) => Number(l.quantity || 0) > 0)
    .map((l) => ({
      name: String(l.name || 'Item'),
      qty: String(('quantity_label' in l ? l.quantity_label : undefined) || l.quantity || 0),
      amount: Number(l.line_total ?? Number(l.price || 0) * Number(l.quantity || 0)),
    }));
}

function billTotals(order: BillOrder) {
  const inv = order.invoice || {};
  return {
    total: Number(inv.mrp_subtotal || inv.subtotal || order.subtotal || 0),
    discount: Number(inv.promo_discount || 0) + Number(inv.shop_order_discount || 0) + Number(inv.wallet_discount || 0) + Number(inv.product_discount_total || 0),
    delivery: Number(inv.delivery_fee ?? order.delivery_fee ?? 0),
    platform: Number(inv.platform_fee_amount || 0),
    packing: Number(inv.packaging_charge_amount || 0),
    tax: Number(inv.platform_tax_amount || 0),
    taxName: String(inv.platform_tax_name || 'GST'),
    net: Number(inv.cod_collect_amount ?? inv.total_amount ?? order.total_amount ?? 0),
    pay: String(inv.payment_method || order.payment_method || 'COD').toUpperCase(),
  };
}

function collectBillRows(order: BillOrder, pharmacy?: BillPharmacy): BillRow[] {
  const inv = order.invoice || {};
  const rows: BillRow[] = [];
  const line = (text: string, opts?: { center?: boolean; rule?: boolean }) => rows.push({ text: ascii(text).slice(0, TSPL_COLS), center: !!opts?.center, rule: !!opts?.rule });
  const pair = (left: string, right: string) => line(padLine(left, right, TSPL_COLS));
  const totals = billTotals(order);
  line('ZEPMED', { center: true });
  line('Local Pharmacy', { center: true });
  line('', { rule: true });
  wrapText(String(inv.pharmacy_name || pharmacy?.name || 'Pharmacy'), TSPL_COLS).forEach((t) => line(t));
  wrapText(inv.pharmacy_address || [pharmacy?.address, pharmacy?.city].filter(Boolean).join(', '), TSPL_COLS).forEach((t) => t && line(t));
  if (inv.pharmacy_dl_number || pharmacy?.dl_number) wrapText(`DL: ${inv.pharmacy_dl_number || pharmacy?.dl_number}`, TSPL_COLS).forEach((t) => line(t));
  if (inv.pharmacy_gstin || pharmacy?.gstin) line(`GST: ${inv.pharmacy_gstin || pharmacy?.gstin}`);
  if (inv.pharmacy_phone || pharmacy?.phone) line(`Ph: ${inv.pharmacy_phone || pharmacy?.phone}`);
  line('', { rule: true });
  wrapText(`No: ${inv.invoice_number || inv.order_number || order.order_number || '-'}`, TSPL_COLS).forEach((t) => line(t));
  line(String(inv.invoice_date || order.created_at || '').replace('T', ' ').slice(0, 16));
  wrapText(`Cust: ${inv.customer_name || order.customer_name || '-'}`, TSPL_COLS).forEach((t) => line(t));
  line(`Ph: ${inv.customer_phone || order.customer_phone || order.customer_mobile || '-'}`);
  line('', { rule: true });
  line(itemCols('ITEM', 'QTY', 'AMT'));
  billLines(order).forEach((item) => {
    wrapText(item.name, ITEM_NAME_W).forEach((t, i) => line(i === 0 ? itemCols(t, item.qty, moneyEsc(item.amount)) : itemCols(t, '', '')));
  });
  line('', { rule: true });
  pair('Total', moneyEsc(totals.total));
  pair('Discount', moneyEsc(totals.discount));
  pair('Delivery', totals.delivery === 0 ? 'FREE' : moneyEsc(totals.delivery));
  if (totals.platform > 0) pair('Platform', moneyEsc(totals.platform));
  if (totals.packing > 0) pair('Packing', moneyEsc(totals.packing));
  if (totals.tax > 0) pair(totals.taxName, moneyEsc(totals.tax));
  pair('NET PAY', moneyEsc(totals.net));
  line(`Pay: ${totals.pay}`);
  line('Thank you', { center: true });
  return rows;
}

function tsplEscape(s: string) {
  return ascii(s).replace(/"/g, "'");
}

function tsplText(x: number, y: number, text: string, xmul = TSPL_XMUL, ymul = TSPL_YMUL) {
  const maxChars = xmul === TITLE_XMUL ? 12 : TSPL_COLS;
  return `TEXT ${x},${y},"${TSPL_FONT}",0,${xmul},${ymul},"${tsplEscape(text).slice(0, maxChars)}"`;
}

function buildTspl(order: BillOrder, pharmacy?: BillPharmacy, paper = 'continuous') {
  const rows = collectBillRows(order, pharmacy);
  const cmds: string[] = [];
  let y = 2;
  let lastInk = BODY_GLYPH_H;
  rows.forEach((r) => {
    if (r.rule) {
      cmds.push(tsplText(TSPL_LEFT, y, '-'.repeat(TSPL_COLS)));
      lastInk = y + BODY_GLYPH_H;
      y += TSPL_LH;
      return;
    }
    const text = tsplEscape(r.text || (r.right ? padLine(r.left || '', r.right, TSPL_COLS) : (r.left || '')));
    if (!text) {
      y += 4;
      return;
    }
    const title = !!r.center && text === 'ZEPMED';
    const cw = title ? TITLE_CW : TSPL_CW;
    const x = r.center ? Math.max(0, Math.floor((LABEL_DOTS - text.length * cw) / 2)) : TSPL_LEFT;
    cmds.push(title ? tsplText(x, y, text, TITLE_XMUL, TITLE_YMUL) : tsplText(x, y, text));
    lastInk = y + (title ? TITLE_GLYPH_H : BODY_GLYPH_H);
    y += title ? TITLE_LH : TSPL_LH;
  });
  // Continuous roll has no gap/black mark. BLINE/GAP sensing and SET TEAR ON
  // make Milestone keep feeding a blank “page” looking for a stop mark.
  const heightMm = Math.max(12, Math.ceil(lastInk / 8) + (paper === 'gap' ? 1 : 2));
  const setup = paper === 'gap'
    ? [
      `SIZE ${LABEL_MM} mm,${heightMm} mm`,
      'GAP 2 mm,0 mm',
      'SET TEAR ON',
    ]
    : [
      `SIZE ${LABEL_MM} mm,${heightMm} mm`,
      'GAP 0 mm,0 mm',
      'OFFSET 0 mm',
      'SET TEAR OFF',
    ];
  return [
    ...setup,
    'SPEED 4',
    'DENSITY 10',
    'DIRECTION 1,0',
    'REFERENCE 0,0',
    'SET PEEL OFF',
    'SET CUTTER OFF',
    'CLS',
    ...cmds,
    'PRINT 1,1',
  ].join('\r\n');
}

function concat(...chunks: Array<number[] | Uint8Array>) {
  const out: number[] = [];
  chunks.forEach((chunk) => { for (let i = 0; i < chunk.length; i += 1) out.push(chunk[i]); });
  return Uint8Array.from(out);
}

function textBytes(value: string) {
  const clean = ascii(value);
  const out = new Uint8Array(clean.length);
  for (let i = 0; i < clean.length; i += 1) out[i] = clean.charCodeAt(i) & 0xff;
  return out;
}

function buildEscPos(order: BillOrder, pharmacy?: BillPharmacy) {
  const INIT = [0x1B, 0x40, 0x1B, 0x53, 0x1C, 0x2E, 0x1B, 0x74, 0x00, 0x1B, 0x32, 0x1B, 0x4D, 0x00, 0x1D, 0x21, 0x00];
  const CENTER = [0x1B, 0x61, 0x01];
  const LEFT = [0x1B, 0x61, 0x00];
  const BOLD_ON = [0x1B, 0x45, 0x01];
  const BOLD_OFF = [0x1B, 0x45, 0x00];
  const DOUBLE_ON = [0x1D, 0x21, 0x01];
  const NORMAL = [0x1D, 0x21, 0x00];
  const TEAR_FEED = [0x1B, 0x64, 0x03];
  const chunks: Array<number[] | Uint8Array> = [];
  const line = (value = '') => chunks.push(textBytes(`${value}\n`));
  const rule = () => line('-'.repeat(ESC_COLS));
  const inv = order.invoice || {};
  const totals = billTotals(order);
  chunks.push(INIT, CENTER, BOLD_ON, DOUBLE_ON);
  line('ZEPMED');
  chunks.push(NORMAL, BOLD_OFF);
  line(inv.pharmacy_name || pharmacy?.name || 'PHARMACY');
  wrapText(inv.pharmacy_address || [pharmacy?.address, pharmacy?.city].filter(Boolean).join(', '), ESC_COLS).forEach((t) => line(t));
  chunks.push(LEFT);
  rule();
  line(`No: ${inv.invoice_number || order.order_number || '-'}`);
  line(String(inv.invoice_date || order.created_at || '').replace('T', ' ').slice(0, 16));
  line(`Cust: ${inv.customer_name || order.customer_name || '-'}`);
  line(`Ph: ${inv.customer_phone || order.customer_phone || order.customer_mobile || '-'}`);
  rule();
  chunks.push(BOLD_ON);
  line(padLine('ITEM', 'AMT', ESC_COLS));
  chunks.push(BOLD_OFF);
  billLines(order).forEach((item) => line(padLine(`${item.name.slice(0, 18)} x${item.qty}`, moneyEsc(item.amount), ESC_COLS)));
  rule();
  line(padLine('Total', moneyEsc(totals.total), ESC_COLS));
  line(padLine('Discount', moneyEsc(totals.discount), ESC_COLS));
  line(padLine('Delivery', totals.delivery === 0 ? 'FREE' : moneyEsc(totals.delivery), ESC_COLS));
  if (totals.platform > 0) line(padLine('Platform', moneyEsc(totals.platform), ESC_COLS));
  if (totals.packing > 0) line(padLine('Packing', moneyEsc(totals.packing), ESC_COLS));
  if (totals.tax > 0) line(padLine(totals.taxName, moneyEsc(totals.tax), ESC_COLS));
  chunks.push(BOLD_ON);
  line(padLine('NET PAY', moneyEsc(totals.net), ESC_COLS));
  chunks.push(BOLD_OFF);
  line(`Pay: ${totals.pay}`);
  chunks.push(CENTER);
  line('Thank you');
  chunks.push(TEAR_FEED);
  return concat(...chunks);
}

function layoutCss(type: PrinterLayout) {
  if (type === 'a4_half') {
    return `
      @page { size: 148mm auto; margin: 6mm; }
      *{box-sizing:border-box} html,body{margin:0;padding:0}
      body{font-family:Arial,sans-serif;font-size:11px;color:#111;max-width:148mm}
      .brand{font-size:18px;font-weight:bold;text-align:center;margin:0 0 4px;letter-spacing:1.2px;text-transform:uppercase;color:#0f766e}
      .tagline{color:#555;font-size:10px;margin:0 0 8px;text-align:center}
      .hr{border:none;border-top:1px solid #ccc;margin:8px 0}
      .meta{margin-bottom:4px;line-height:1.45;font-size:11px}
      .meta strong{display:inline-block;min-width:118px}
      table{width:100%;border-collapse:collapse;margin:8px 0}
      th,td{padding:4px 3px;text-align:left;vertical-align:top}
      th{font-size:10px;border-bottom:1px solid #999;background:#f8f8f8}
      td{border-bottom:1px solid #eee}
      .c{text-align:center} .r{text-align:right}
      .totals{width:100%;margin-top:8px} .totals td{border:none;padding:3px 0}
      .totals .label{text-align:right;padding-right:12px;color:#333;width:72%}
      .grand td{font-weight:bold;font-size:13px;border-top:2px solid #111;padding-top:6px!important}
      .foot{margin-top:10px;font-size:12px;text-align:center;font-weight:bold}`;
  }
  return `
    @page { size: 58mm auto; margin: 0; }
    *{box-sizing:border-box} html,body{margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:9px;color:#111;max-width:58mm}
    .brand{font-size:12px;font-weight:bold;text-align:center;margin:0 0 2px;letter-spacing:1px;text-transform:uppercase}
    .tagline{color:#444;font-size:7px;margin:0 0 4px;text-align:center}
    .hr{border:none;border-top:1px dashed #999;margin:4px 0}
    .meta{margin-bottom:2px;line-height:1.3;font-size:8px}
    .meta strong{display:inline-block;min-width:72px}
    table{width:100%;border-collapse:collapse;margin:4px 0;font-size:7px}
    th,td{padding:2px 1px;text-align:left;vertical-align:top;word-break:break-word}
    th{font-size:7px;border-bottom:1px solid #999} td{border-bottom:1px dashed #ddd}
    .c{text-align:center} .r{text-align:right}
    .totals{width:100%;font-size:8px;margin-top:4px} .totals td{border:none;padding:1px 0}
    .totals .label{text-align:right;padding-right:4px;color:#333;width:68%}
    .grand td{font-weight:bold;border-top:1px solid #111;padding-top:3px!important}
    .foot{margin-top:4px;font-size:8px;text-align:center;font-weight:bold}`;
}

export function buildBillHtml(order: BillOrder, layout: PrinterLayout = 'thermal_58', pharmacy?: BillPharmacy) {
  const inv = order.invoice || {};
  const lines = billLines(order);
  const totals = billTotals(order);
  const rows = lines.length
    ? lines.map((l, idx) => `<tr><td class="c">${idx + 1}</td><td>${l.name.slice(0, layout === 'thermal_58' ? 18 : 28)}</td><td class="c">${l.qty}</td><td class="r">${money(l.amount / Math.max(1, Number(l.qty) || 1))}</td><td class="r">${money(l.amount)}</td></tr>`).join('')
    : '<tr><td class="c" colspan="5">No billable items</td></tr>';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bill ${order.order_number || ''}</title>
<style>${layoutCss(layout)}</style></head><body>
  <div class="brand">ZEPMED</div>
  <div class="tagline">Powered by Local Retail Pharmacy</div>
  <hr class="hr">
  <div class="meta"><strong>RETAILER NAME :</strong> ${dash(inv.pharmacy_name || pharmacy?.name)}</div>
  <div class="meta"><strong>Address :</strong> ${dash(inv.pharmacy_address || [pharmacy?.address, pharmacy?.city].filter(Boolean).join(', '))}</div>
  <div class="meta"><strong>Drug License No. :</strong> ${dash(inv.pharmacy_dl_number || pharmacy?.dl_number)}</div>
  <div class="meta"><strong>GSTIN :</strong> ${dash(inv.pharmacy_gstin || pharmacy?.gstin)}</div>
  <div class="meta"><strong>Mobile :</strong> ${dash(inv.pharmacy_phone || pharmacy?.phone)}</div>
  <hr class="hr">
  <div class="meta"><strong>Bill No. :</strong> ${dash(inv.invoice_number || inv.order_number || order.order_number)}</div>
  <div class="meta"><strong>Date &amp; Time :</strong> ${dash(inv.invoice_date || order.created_at)}</div>
  <div class="meta"><strong>Customer Name :</strong> ${dash(inv.customer_name || order.customer_name)}</div>
  <div class="meta"><strong>Mobile No. :</strong> ${dash(inv.customer_phone || order.customer_phone || order.customer_mobile)}</div>
  <hr class="hr">
  <table><thead><tr><th>Sr</th><th>Medicine Name</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amt</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <hr class="hr">
  <table class="totals">
    <tr><td class="label">Total Amount :</td><td class="r">${money(totals.total)}</td></tr>
    <tr><td class="label">Discount :</td><td class="r">${money(totals.discount)}</td></tr>
    <tr><td class="label">Delivery Charge :</td><td class="r">${totals.delivery === 0 ? 'FREE' : money(totals.delivery)}</td></tr>
    ${totals.platform > 0 ? `<tr><td class="label">Platform Fee :</td><td class="r">${money(totals.platform)}</td></tr>` : ''}
    ${totals.packing > 0 ? `<tr><td class="label">Packaging :</td><td class="r">${money(totals.packing)}</td></tr>` : ''}
    ${totals.tax > 0 ? `<tr><td class="label">${totals.taxName} :</td><td class="r">${money(totals.tax)}</td></tr>` : ''}
    <tr class="grand"><td class="label">Net Payable :</td><td class="r">${money(totals.net)}</td></tr>
  </table>
  <div class="meta" style="margin-top:6px"><strong>Payment Mode :</strong> ${dash(totals.pay)}</div>
  <div class="foot">Thank You For Your Purchase!</div>
</body></html>`;
}

function printPageSize(order: BillOrder, layout: PrinterLayout) {
  const lines = 20 + billLines(order).length * 2;
  if (layout === 'a4_half') return { width: 420, height: Math.max(360, 48 + lines * 16) };
  return { width: 165, height: Math.max(220, 28 + lines * 13) };
}

async function printHtmlTight(order: BillOrder, layout: PrinterLayout, pharmacy?: BillPharmacy) {
  const html = buildBillHtml(order, layout, pharmacy);
  const size = printPageSize(order, layout);
  await Print.printAsync({
    html,
    width: size.width,
    height: size.height,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}

export async function printBill(order: BillOrder, layout: PrinterLayout = 'thermal_58', pharmacy?: BillPharmacy, options?: PrintOptions) {
  const prefs = await readSellerPrefs();
  const language = String(options?.language || prefs.printerLanguage || 'tspl').toLowerCase();
  const paper = String(options?.paper || prefs.printerPaper || 'continuous').toLowerCase();
  const mac = options?.mac || prefs.printerMac || '';

  if (layout === 'thermal_58' && mac) {
    const payload = language === 'escpos' || language === 'esc/pos'
      ? buildEscPos(order, pharmacy)
      : textBytes(buildTspl(order, pharmacy, paper));
    await printToBluetooth(mac, payload);
    return;
  }

  if (layout === 'thermal_58' && !mac) {
    throw new Error('Select a paired Bluetooth printer in Printer Settings, then print again.');
  }

  await printHtmlTight(order, layout, pharmacy);
}

export async function shareBillPdf(order: BillOrder, layout: PrinterLayout = 'thermal_58', pharmacy?: BillPharmacy) {
  const html = buildBillHtml(order, layout, pharmacy);
  const size = printPageSize(order, layout);
  const file = await Print.printToFileAsync({
    html,
    width: size.width,
    height: size.height,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { UTI: '.pdf', mimeType: 'application/pdf', dialogTitle: `Bill ${order.order_number || ''}` });
  }
  return file.uri;
}

export function csvFromRows(headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}
