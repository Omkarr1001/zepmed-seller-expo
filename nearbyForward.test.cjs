const assert = require('assert');

function nearbyRetailOnly(list) {
  return (list ?? []).filter((pharmacy) => {
    const label = String(pharmacy.nearby_label ?? '').trim().toLowerCase();
    if (label === 'other area') return false;
    if (label === 'same pincode' || label === 'nearby') return true;
    const km = Number(pharmacy.distance_km);
    return Number.isFinite(km) && km <= 5;
  });
}

function formatForwardPharmacy(pharmacy) {
  const name = pharmacy.name?.trim() || `Pharmacy #${pharmacy.id}`;
  const label = pharmacy.nearby_label?.trim();
  return label ? `${name} · ${label}` : name;
}

const dattakrupaDump = [
  { id: 53, name: 'Sachin Medical', nearby_label: 'Same pincode', pincode: '412103' },
  { id: 99, name: 'Health Corner', nearby_label: 'Other area', pincode: '413102' },
  { id: 12, name: 'Far Shop', nearby_label: 'Other area', distance_km: 18 },
  { id: 70, name: 'Close Shop', nearby_label: 'Nearby', distance_km: 2.1 },
  { id: 71, name: 'Five Km', distance_km: 5 },
  { id: 72, name: 'Too Far', distance_km: 5.1 },
];

const filtered = nearbyRetailOnly(dattakrupaDump);
assert.deepStrictEqual(filtered.map((p) => p.id), [53, 70, 71]);
assert.strictEqual(filtered.some((p) => /health corner/i.test(p.name)), false);
assert.strictEqual(formatForwardPharmacy(filtered[0]), 'Sachin Medical · Same pincode');

const pinOnly = nearbyRetailOnly([
  { id: 53, name: 'Sachin Medical', nearby_label: 'Same pincode', pincode: '412103' },
]);
assert.deepStrictEqual(pinOnly.map((p) => p.id), [53]);
assert.strictEqual(pinOnly[0].name, 'Sachin Medical');

console.log('nearbyRetailOnly ok', filtered.map((p) => `${p.id}:${p.name}`).join(', '));
