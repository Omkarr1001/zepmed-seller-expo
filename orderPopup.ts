/** Bill + name helpers so the new-order popup matches order history. */

export function positiveAmount(...values: unknown[]): number {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export type Billish = {
  total_amount?: number | null;
  customer_payable?: number | null;
  cod_collect_amount?: number | null;
  grand_total?: number | null;
  bill_total?: number | null;
  amount?: number | null;
  subtotal?: number | null;
  seller_payout_amount?: number | null;
  invoice?: { total_amount?: number | null; subtotal?: number | null } | null;
};

export function orderBillAmount(order?: Billish | null): number {
  if (!order) return 0;
  return positiveAmount(
    order.total_amount,
    order.customer_payable,
    order.cod_collect_amount,
    order.grand_total,
    order.bill_total,
    order.amount,
    order.invoice?.total_amount,
    order.subtotal,
    order.invoice?.subtotal,
    order.seller_payout_amount,
  );
}

export function orderCustomerName(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && text.toLowerCase() !== 'customer') return text;
  }
  return '';
}

export function mergeIncomingOrder<T extends Billish & { id: number; customer_name?: string | null }>(
  prev: T | undefined,
  next: T,
): T {
  const merged = { ...(prev || {}), ...next } as T;
  const amount = orderBillAmount(merged) || orderBillAmount(prev) || orderBillAmount(next);
  const name = orderCustomerName(next.customer_name, prev?.customer_name) || next.customer_name || prev?.customer_name || null;
  return { ...merged, total_amount: amount, customer_name: name };
}

export function popupDecisionActions(order: {
  status?: string | null;
  order_type?: string | null;
  is_prescription_order?: boolean | null;
  seller_confirmed_at?: string | null;
}): Array<{ code: string; label: string }> {
  const status = String(order.status || '').toLowerCase();
  if (['rejected', 'cancelled'].includes(status)) return [];
  const pending = ['placed', 'new', 'pending', 'prescription_review'].includes(status);
  if (!pending) return [];
  const rx = order.order_type === 'prescription'
    || order.is_prescription_order === true
    || status === 'prescription_review';
  const confirmed = String(order.seller_confirmed_at || '').trim();
  const already = confirmed !== '' && confirmed !== '0000-00-00 00:00:00' && confirmed.toLowerCase() !== 'null';
  const actions: Array<{ code: string; label: string }> = [];
  if (!(rx && already)) actions.push({ code: rx ? 'rx_accept' : 'confirmed', label: 'Accept' });
  actions.push({ code: 'rejected', label: 'Reject' });
  if (rx) actions.push({ code: 'wrong_prescription', label: 'Wrong prescription' });
  const seen = new Set<string>();
  return actions.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}
