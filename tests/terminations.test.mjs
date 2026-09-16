import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TERMINATION_PROFILE, collectTerminations, parseTermination, resolveTermination } from '../src/terminations.ts';

function fixture() {
  const model = new THREE.Group(), door = new THREE.Group(), component = new THREE.Group(), node = new THREE.Object3D();
  model.add(door); door.add(component); component.add(node);
  component.userData = { instance_id: 'X2.01', gppTerminations: { profile: TERMINATION_PROFILE, component_id: 'AB_1492-J4' } };
  node.userData.gppTermination = {
    profile: TERMINATION_PROFILE, id: 'A', label: 'Upper conductor entry', kind: 'wire_entry',
    electrical_node: '1', manufacturer_marking: null, designation_basis: 'Authoring alias',
    status: 'cad-derived', routing_eligible: true, insertion_depth_m: null,
    evidence: { source: 'housing.stp', source_sha256: 'a'.repeat(64), feature: 'Entry cavity', interpretation: 'CAD-derived mouth' },
  };
  node.position.set(0, .05, .0175);
  node.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  return { model, door, component, node };
}

test('entry and outward tangent follow component placement and moving door', () => {
  const { model, door, component } = fixture();
  component.position.set(.1, .2, .3);
  component.rotation.z = Math.PI / 2;
  door.position.set(.4, 0, 0);
  door.rotation.y = Math.PI / 2;
  const { point, outward } = resolveTermination(model, 'X2.01:A');
  assert(point.distanceTo(new THREE.Vector3(.7175, .2, -.05)) < 1e-10);
  assert(outward.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-10);
  door.rotation.y = 0;
  const moved = resolveTermination(model, 'X2.01:A');
  assert(moved.point.distanceTo(new THREE.Vector3(.45, .2, .3175)) < 1e-10);
  assert(moved.outward.distanceTo(new THREE.Vector3(-1, 0, 0)) < 1e-10);
});

test('duplicate local or instance IDs, missing IDs and provisional anchors cannot route', () => {
  const { model, node, component } = fixture();
  assert.throws(() => resolveTermination(model, 'X2.01:unknown'), /Unresolved/);
  node.userData.gppTermination.status = 'provisional';
  assert.equal(parseTermination(node.userData.gppTermination), null, 'Provisional geometry cannot claim routing eligibility');
  node.userData.gppTermination.routing_eligible = false;
  assert.equal(collectTerminations(model).anchors.length, 1, 'Provisional point is still inspectable');
  assert.throws(() => resolveTermination(model, 'X2.01:A'), /not routing eligible/);
  node.userData.gppTermination.status = 'cad-derived';
  node.userData.gppTermination.routing_eligible = true;
  const duplicate = node.clone(); component.add(duplicate);
  assert.deepEqual(collectTerminations(model), { anchors: [], rejected: 2 });
  duplicate.removeFromParent();
  model.add(component.clone());
  assert.throws(() => resolveTermination(model, 'X2.01:A'), /ambiguous/);
});

test('rejects unresolved placeholders, malformed metadata and distorted frames', () => {
  for (const mutate of [
    f => { f.node.userData.gppTermination.evidence.source_sha256 = ''; },
    f => { f.node.userData.gppTermination.status = 'unresolved'; f.node.userData.gppTermination.routing_eligible = false; },
    f => { f.node.position.x = NaN; },
    f => { f.component.scale.set(1, 2, 1); },
    f => { f.component.scale.set(-1, 1, 1); },
    f => { f.node.userData.gppTermination.insertion_depth_m = Infinity; },
  ]) {
    const f = fixture(); mutate(f);
    assert.deepEqual(collectTerminations(f.model), { anchors: [], rejected: 1 });
  }
});
