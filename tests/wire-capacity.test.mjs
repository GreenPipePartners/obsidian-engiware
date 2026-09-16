import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { checkWireCapacity, parseWireCapacity, WIRE_CAPACITY_PROFILE, awgAreaMm2, largestAwgWithinArea, wireEndFromAwg, describeWireCapacity } from '../src/wire-capacity.ts';
import { resolveTermination, resolveWireTerminations, TERMINATION_PROFILE } from '../src/terminations.ts';

const rating = {
  profile: WIRE_CAPACITY_PROFILE, interface: 'wire_clamp', preparation: 'single_ferrule', material: 'copper',
  max_conductors: 1, twin_ferrules: false, status: 'verified', min_area_mm2: .5, max_area_mm2: 4,
  ferrule_collar: 'either', max_ferrule_diameter_mm: null, ferrule_barrel_length_mm: null,
  manufacturer_awg_range: null, evidence: [{ source: 'manufacturer.pdf', source_sha256: 'a'.repeat(64), page: '3', statement: 'Single ferruled wire 0.5–4 mm²' }], note: '',
};
const wire = { area_mm2: 1.5, material: 'copper', conductor_count: 1, preparation: 'single_ferrule', ferrule_collar: 'uninsulated' };
const check = (r = {}, w = {}, occupied = 0) => checkWireCapacity({ ...rating, ...r }, { ...wire, ...w }, occupied);

test('ferruled area limits are inclusive and independent of the bare-wire or AWG label', () => {
  assert.equal(check({}, { area_mm2: .5 }).status, 'compatible');
  assert.equal(check({ manufacturer_awg_range: '26–10 AWG (general)' }, { area_mm2: 4 }).status, 'compatible');
  for (const area_mm2 of [.49, 4.01, 6, 0, -1, NaN, Infinity]) assert.equal(check({}, { area_mm2 }).status, 'incompatible');
  for (const preparation of ['bare', 'twin_ferrule']) assert.equal(check({}, { preparation }).status, 'incompatible');
  assert.equal(check({}, { material: 'aluminium' }).status, 'incompatible');
  assert.equal(check({}, { conductor_count: 2 }).status, 'incompatible');
  assert.equal(check({}, {}, 1).status, 'incompatible');
});

test('unknown ratings and absent or corrupt metadata never authorize sized routing', () => {
  for (const value of [undefined, null, {}, { ...rating, max_area_mm2: '4' }, { ...rating, max_area_mm2: Infinity },
    { ...rating, min_area_mm2: 5 }, { ...rating, evidence: [] }, { ...rating, twin_ferrules: true }]) {
    assert.equal(parseWireCapacity(value), null);
    assert.equal(checkWireCapacity(value, wire).status, 'unresolved');
  }
  assert.equal(check({ status: 'provisional' }).status, 'unresolved');
  assert.equal(check({ status: 'unknown', max_area_mm2: null }).status, 'unresolved');
});

test('selected crimp envelope and barrel length must satisfy every published condition', () => {
  const r = { max_area_mm2: 1.5, ferrule_collar: 'uninsulated', max_ferrule_diameter_mm: 1.6, ferrule_barrel_length_mm: 10 };
  assert.equal(check(r).status, 'unresolved');
  const selected = { ferrule_diameter_mm: 1.6, ferrule_barrel_length_mm: 10 };
  assert.equal(check(r, selected).status, 'compatible');
  for (const w of [{ ferrule_diameter_mm: 1.61 }, { ferrule_barrel_length_mm: 8 }, { ferrule_collar: 'insulated' }, { ferrule_diameter_mm: NaN }]) {
    assert.equal(check(r, { ...selected, ...w }).status, 'incompatible');
  }
});

function model() {
  const root = new THREE.Group();
  for (const [instance, max] of [['X1', 4], ['X2', 1.5]]) {
    const component = new THREE.Group();
    component.userData = { instance_id: instance, gppTerminations: { profile: TERMINATION_PROFILE, component_id: 'TEST' } };
    for (const id of ['A', 'B']) {
      const node = new THREE.Object3D();
      node.userData.gppTermination = { profile: TERMINATION_PROFILE, id, label: id, kind: 'wire_entry', electrical_node: '1',
        manufacturer_marking: null, designation_basis: 'Alias', status: 'verified', routing_eligible: true, insertion_depth_m: null,
        evidence: { source: 'test.stp', source_sha256: 'b'.repeat(64), feature: 'Mouth', interpretation: 'Test fixture' },
        wire_capacity: { ...rating, max_area_mm2: max, shared_clamp_id: 'CLAMP1' } };
      component.add(node);
    }
    root.add(component);
  }
  return root;
}

test('wire resolver checks both ends and shared-clamp occupancy while keeping geometry lookup available', () => {
  const m = model();
  assert(resolveWireTerminations(m, 'X1:A', 'X2:A', wire));
  assert.throws(() => resolveWireTerminations(m, 'X1:A', 'X2:A', { ...wire, area_mm2: 2.5 }), /exceeds 1.5/);
  assert.throws(() => resolveWireTerminations(m, 'X1:A', 'X2:A', wire, { ...wire, area_mm2: 1 }), /same conductor/);
  assert.throws(() => resolveWireTerminations(m, 'X1:A', 'X1:B', wire), /same single-conductor clamp/);
  assert.throws(() => resolveWireTerminations(m, 'X1:B', 'X2:A', wire, wire, new Map([['X1:CLAMP1', 1]])), /Only one/);
  delete m.children[1].children[0].userData.gppTermination.wire_capacity;
  assert(resolveTermination(m, 'X2:A'));
  assert.throws(() => resolveWireTerminations(m, 'X1:A', 'X2:A', wire), /unresolved/);
});

test('a valid ferrule rating never makes provisional geometry eligible', () => {
  const m = model(), a = m.children[0].children[0].userData.gppTermination;
  a.status = 'provisional'; a.routing_eligible = false;
  assert.throws(() => resolveWireTerminations(m, 'X1:A', 'X2:A', wire), /not routing eligible/);
});

test('display scaling never scales a rated physical connection', () => {
  const m = model(); m.scale.setScalar(2);
  assert(resolveTermination(m, 'X1:A'));
  assert.throws(() => resolveWireTerminations(m, 'X1:A', 'X2:A', wire), /unit physical scale/);
});

test('explicit largest AWG always rounds toward a smaller conductor, including aught gauges', () => {
  for (const [area, expected] of [[1.5, '16'], [2.5, '14'], [4, '12'], [6, '10'], [16, '6'], [35, '2'], [50, '1'], [70, '2/0'], [95, '3/0']]) {
    assert.equal(largestAwgWithinArea(area), expected);
    assert(awgAreaMm2(expected) <= area);
  }
  assert(awgAreaMm2('10') > 4);
  assert(awgAreaMm2('4/0') > awgAreaMm2('3/0'));
  for (const invalid of ['0', '0000', '04', '41', '5/0', '-1', '12.5', 'AWG 12', 12]) assert.equal(awgAreaMm2(invalid), null);
});

test('AWG routing enforces the largest permitted conductor and still requires a ferrule', () => {
  const c = { ...rating, max_ferruled_wire_awg: '12', awg_limit_basis: 'conservative_area' };
  const preparation = { material: 'copper', conductor_count: 1, preparation: 'single_ferrule', ferrule_collar: 'uninsulated' };
  for (const awg of ['12', '14', '16', '18']) assert.equal(checkWireCapacity(c, wireEndFromAwg(awg, preparation)).status, 'compatible');
  for (const awg of ['11', '10', '8']) assert.equal(checkWireCapacity(c, wireEndFromAwg(awg, preparation)).status, 'incompatible');
  assert.equal(checkWireCapacity(c, wireEndFromAwg('12', { ...preparation, preparation: 'bare' })).status, 'incompatible');
  assert.equal(checkWireCapacity(c, { ...wireEndFromAwg('10', preparation), area_mm2: 3.31 }).status, 'incompatible');
  assert.equal(checkWireCapacity({ ...c, status: 'provisional' }, wireEndFromAwg('12', preparation)).status, 'unresolved');
  assert.equal(checkWireCapacity(rating, wireEndFromAwg('12', preparation)).status, 'unresolved', 'Legacy records do not invent an AWG limit');
  assert.equal(parseWireCapacity({ ...c, max_ferruled_wire_awg: '10' }), null, 'An oversized AWG maximum contradicts the area limit');
  assert.match(describeWireCapacity(c), /Maximum ferruled wire: 12 AWG · 4 mm²/);
  assert.match(describeWireCapacity(c), /conservative area-derived limit/);
});

test('published AWG restrictions and rounded areas cannot bypass connection limits', () => {
  const c = { ...rating, max_area_mm2: 6, max_ferruled_wire_awg: '12', awg_limit_basis: 'manufacturer_ferrule' };
  const w = wireEndFromAwg('10', { material: 'copper', conductor_count: 1, preparation: 'single_ferrule', ferrule_collar: 'uninsulated' });
  assert.equal(checkWireCapacity(c, w).status, 'incompatible');
  const rounded = { ...wireEndFromAwg('12', w), area_mm2: 3.31 };
  assert.equal(checkWireCapacity(c, rounded).status, 'compatible');
  assert.equal(checkWireCapacity({ ...c, min_area_mm2: 3.31 }, rounded).status, 'incompatible');
  assert.throws(() => wireEndFromAwg('5/0', w), /AWG label/);
});
