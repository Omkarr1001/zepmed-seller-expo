export type NearbyPharmacy = {
  id: number;
  name?: string | null;
  city?: string | null;
  nearby_label?: string | null;
  distance_km?: number | null;
  pincode?: string | null;
};

/** Same-pin / Nearby / ≤5km only — drop "Other area" city dumps. */
export function nearbyRetailOnly<T extends NearbyPharmacy>(list?: T[] | null): T[] {
  return (list ?? []).filter((pharmacy) => {
    const label = String(pharmacy.nearby_label ?? '').trim().toLowerCase();
    if (label === 'other area') return false;
    if (label === 'same pincode' || label === 'nearby') return true;
    const km = Number(pharmacy.distance_km);
    return Number.isFinite(km) && km <= 5;
  });
}

export function formatForwardPharmacy(pharmacy: NearbyPharmacy): string {
  const name = pharmacy.name?.trim() || `Pharmacy #${pharmacy.id}`;
  const label = pharmacy.nearby_label?.trim();
  return label ? `${name} · ${label}` : name;
}
