/** Conductor area is nominal copper mm²; ferrule dimensions describe the crimped metal envelope. */
export const WIRE_CAPACITY_PROFILE = 'gpp.wire-capacity@0.1.0';
export interface WireCapacity {
  profile: typeof WIRE_CAPACITY_PROFILE;
  interface: 'wire_clamp' | 'crimp_barrel' | 'installation_boundary' | 'accessory_interface';
  preparation: 'single_ferrule' | null;
  material: 'copper' | null;
  max_conductors: 1 | null;
  twin_ferrules: false;
  status: 'verified' | 'provisional' | 'unknown' | 'not_applicable';
  min_area_mm2: number | null;
  max_area_mm2: number | null;
  ferrule_collar: 'uninsulated' | 'insulated' | 'either' | null;
  max_ferrule_diameter_mm: number | null;
  ferrule_barrel_length_mm: number | null;
  manufacturer_awg_range: string | null;
  /** Largest permitted conductor; lower AWG numbers are larger wires. Absent only in legacy records. */
  max_ferruled_wire_awg?: string | null;
  awg_limit_basis?: 'manufacturer_ferrule' | 'conservative_area' | 'unknown' | 'not_applicable';
  shared_clamp_id?: string;
  evidence: { source: string; source_sha256: string; page: string; statement: string }[];
  note: string;
}

export interface WireEnd {
  area_mm2: number;
  awg?: string;
  material: string;
  conductor_count: number;
  preparation: string;
  ferrule_collar: string;
  ferrule_diameter_mm?: number;
  ferrule_barrel_length_mm?: number;
}
export interface CapacityCheck {
  status: 'compatible' | 'incompatible' | 'unresolved' | 'not_applicable';
  reasons: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown, max = 2048): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && [...value].every(c => c.charCodeAt(0) >= 32);
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Nominal AWG copper area, not jacket diameter or ferrule outside area. */
export function awgAreaMm2(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const index = /^[1-4]\/0$/.test(value) ? 1 - Number(value[0])
    : /^(?:[1-9]|[12][0-9]|3[0-9]|40)$/.test(value) ? Number(value) : null;
  return index === null ? null : Math.PI / 4 * (.127 * 92 ** ((36 - index) / 39)) ** 2;
}

export function largestAwgWithinArea(maximum: number): string | null {
  if (!positive(maximum)) return null;
  for (let n = -3; n <= 40; n++) {
    const label = n > 0 ? String(n) : `${1 - n}/0`;
    if (awgAreaMm2(label)! <= maximum) return label;
  }
  return null;
}

export function wireEndFromAwg(awg: string, end: Omit<WireEnd, 'area_mm2' | 'awg'>): WireEnd {
  const area = awgAreaMm2(awg);
  if (area === null) throw new Error('Use an AWG label from 40 through 1, or 1/0 through 4/0');
  return { ...end, awg, area_mm2: area };
}

export function parseWireCapacity(value: unknown): WireCapacity | null {
  const r = record(value);
  if (!r || r.profile !== WIRE_CAPACITY_PROFILE
      || !['wire_clamp', 'crimp_barrel', 'installation_boundary', 'accessory_interface'].includes(String(r.interface))
      || !['verified', 'provisional', 'unknown', 'not_applicable'].includes(String(r.status))
      || r.twin_ferrules !== false || typeof r.note !== 'string' || r.note.length > 2048
      || !(r.manufacturer_awg_range === null || text(r.manufacturer_awg_range))
      || !(r.shared_clamp_id === undefined || text(r.shared_clamp_id, 64))) return null;
  for (const key of ['min_area_mm2', 'max_area_mm2', 'max_ferrule_diameter_mm', 'ferrule_barrel_length_mm']) {
    if (!(r[key] === null || positive(r[key]))) return null;
  }
  if (positive(r.min_area_mm2) && positive(r.max_area_mm2) && r.min_area_mm2 > r.max_area_mm2) return null;
  if (!Array.isArray(r.evidence) || !r.evidence.every(item => {
    const e = record(item);
    return e && text(e.source, 512) && text(e.page) && text(e.statement)
      && typeof e.source_sha256 === 'string' && /^[a-f0-9]{64}$/.test(e.source_sha256);
  })) return null;
  if (r.interface === 'wire_clamp') {
    if (r.preparation !== 'single_ferrule' || r.material !== 'copper' || r.max_conductors !== 1
        || !['uninsulated', 'insulated', 'either'].includes(String(r.ferrule_collar)) || r.status === 'not_applicable'
        || (r.status === 'verified' || r.status === 'provisional') && (!positive(r.max_area_mm2) || !r.evidence.length)
        || r.status === 'unknown' && r.max_area_mm2 !== null) return null;
  } else if (r.status !== 'not_applicable' || [r.preparation, r.material, r.max_conductors, r.ferrule_collar,
    r.min_area_mm2, r.max_area_mm2, r.max_ferrule_diameter_mm, r.ferrule_barrel_length_mm].some(v => v !== null)) return null;
  if (r.max_ferruled_wire_awg !== undefined || r.awg_limit_basis !== undefined) {
    const area = awgAreaMm2(r.max_ferruled_wire_awg);
    if (r.max_ferruled_wire_awg === null) {
      if (r.awg_limit_basis !== (r.status === 'not_applicable' ? 'not_applicable' : 'unknown')) return null;
    } else if (area === null || !positive(r.max_area_mm2) || area > r.max_area_mm2
        || !['verified', 'provisional'].includes(String(r.status))
        || !['manufacturer_ferrule', 'conservative_area'].includes(String(r.awg_limit_basis))
        || r.awg_limit_basis === 'conservative_area' && r.max_ferruled_wire_awg !== largestAwgWithinArea(r.max_area_mm2)) return null;
  }
  return r as unknown as WireCapacity;
}

/** Compatibility with the recorded connection limits, not an ampacity or circuit-protection calculation. */
export function checkWireCapacity(value: unknown, wire: WireEnd, occupiedConductors = 0): CapacityCheck {
  const capacity = parseWireCapacity(value);
  if (!capacity) return { status: 'unresolved', reasons: ['Missing or malformed wire-capacity record'] };
  if (capacity.interface !== 'wire_clamp') return { status: 'not_applicable', reasons: [capacity.note] };
  const reasons: string[] = [];
  const awgArea = wire.awg === undefined ? null : awgAreaMm2(wire.awg);
  if (!positive(wire.area_mm2)) reasons.push('Conductor area must be a positive finite mm² value');
  if (wire.awg !== undefined && (awgArea === null || !positive(wire.area_mm2)
      || Math.abs(wire.area_mm2 - awgArea) / awgArea > .005)) reasons.push('AWG and nominal copper area must agree (0.5% rounding tolerance); metric equivalents are not interchangeable sizes');
  if (wire.material !== 'copper') reasons.push('Copper conductor required');
  if (wire.preparation !== 'single_ferrule') reasons.push('A single ferrule is required; bare ends and twin ferrules are excluded');
  if (wire.conductor_count !== 1 || !Number.isInteger(occupiedConductors) || occupiedConductors < 0
      || wire.conductor_count + occupiedConductors > 1) reasons.push('Only one conductor per physical clamp is allowed');
  if (!['uninsulated', 'insulated'].includes(wire.ferrule_collar)) reasons.push('Specify the ferrule collar type');
  for (const key of ['ferrule_diameter_mm', 'ferrule_barrel_length_mm'] as const) {
    if (wire[key] !== undefined && !positive(wire[key])) reasons.push(`${key} must be positive and finite`);
  }
  if (reasons.length) return { status: 'incompatible', reasons };
  // A provisional reference is useful for inspection but can never authorize a wire.
  if (capacity.status !== 'verified') return { status: 'unresolved', reasons: [`Ferruled-wire rating is ${capacity.status}`] };
  if (Math.max(wire.area_mm2, awgArea ?? 0) > capacity.max_area_mm2!) reasons.push(`Area exceeds ${capacity.max_area_mm2} mm² maximum`);
  const maximumAwgArea = awgAreaMm2(capacity.max_ferruled_wire_awg);
  if (awgArea !== null && maximumAwgArea !== null && awgArea > maximumAwgArea) reasons.push(`Wire exceeds the ${capacity.max_ferruled_wire_awg} AWG maximum conductor size; lower AWG numbers are larger wires`);
  if (capacity.min_area_mm2 !== null && Math.min(wire.area_mm2, awgArea ?? wire.area_mm2) < capacity.min_area_mm2) reasons.push(`Area is below ${capacity.min_area_mm2} mm² minimum`);
  if (capacity.ferrule_collar !== 'either' && wire.ferrule_collar !== capacity.ferrule_collar) reasons.push(`Use a ${capacity.ferrule_collar} ferrule`);
  if (capacity.max_ferrule_diameter_mm !== null && wire.ferrule_diameter_mm !== undefined
      && wire.ferrule_diameter_mm > capacity.max_ferrule_diameter_mm) reasons.push(`Ferrule envelope exceeds ${capacity.max_ferrule_diameter_mm} mm maximum`);
  if (capacity.ferrule_barrel_length_mm !== null && wire.ferrule_barrel_length_mm !== undefined
      && Math.abs(wire.ferrule_barrel_length_mm - capacity.ferrule_barrel_length_mm) > 1e-9) reasons.push(`Ferrule barrel length must be ${capacity.ferrule_barrel_length_mm} mm`);
  if (reasons.length) return { status: 'incompatible', reasons };
  if (wire.awg !== undefined && maximumAwgArea === null) reasons.push('Explicit AWG limit is not established');
  if (capacity.max_ferrule_diameter_mm !== null && wire.ferrule_diameter_mm === undefined) reasons.push('Crimped ferrule envelope diameter is required');
  if (capacity.ferrule_barrel_length_mm !== null && wire.ferrule_barrel_length_mm === undefined) reasons.push('Selected ferrule barrel length is required');
  return { status: reasons.length ? 'unresolved' : 'compatible', reasons };
}

export function describeWireCapacity(value: unknown): string {
  const c = parseWireCapacity(value);
  if (!c) return 'Wire capacity: unrecorded or malformed — sized routing unresolved';
  if (c.interface !== 'wire_clamp') return `Ferrule capacity: N/A · ${c.interface}\n${c.note}`;
  const maximum = c.max_area_mm2 === null ? 'unknown' : `${c.max_area_mm2} mm²`;
  const gauge = c.max_ferruled_wire_awg;
  const awg = gauge ? `${gauge} AWG` : 'AWG unresolved';
  const basis = c.awg_limit_basis === 'manufacturer_ferrule' ? 'manufacturer ferrule rating'
    : c.awg_limit_basis === 'conservative_area' ? 'conservative area-derived limit' : 'unresolved';
  const details = [`Maximum ferruled wire: ${awg} · ${maximum} · ${c.status}`,
    `AWG basis: ${basis}. Lower AWG numbers are larger wires.`, 'One copper conductor; single ferrule required.',
    `Collar: ${c.ferrule_collar}${c.min_area_mm2 === null ? '' : ` · min ${c.min_area_mm2} mm²`}`];
  if (c.max_ferrule_diameter_mm !== null) details.push(`Crimped metal envelope ≤ ${c.max_ferrule_diameter_mm} mm`);
  if (c.ferrule_barrel_length_mm !== null) details.push(`Ferrule barrel length ${c.ferrule_barrel_length_mm} mm`);
  if (c.manufacturer_awg_range) details.push(`Manufacturer wire label: ${c.manufacturer_awg_range}`);
  if (c.shared_clamp_id) details.push(`Shared physical clamp: ${c.shared_clamp_id}`);
  if (c.note) details.push(c.note);
  for (const e of c.evidence) details.push(`${e.source} · ${e.page}: ${e.statement}`);
  return details.join('\n');
}
