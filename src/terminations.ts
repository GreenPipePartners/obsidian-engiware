import * as THREE from 'three';
import { checkWireCapacity, describeWireCapacity, parseWireCapacity } from './wire-capacity.ts';
import type { WireEnd } from './wire-capacity.ts';

export const TERMINATION_PROFILE = 'gpp.termination-anchors@0.1.0';
const KINDS = ['wire_entry', 'jumper', 'bond', 'connector', 'mating_contact', 'bonding_interface'] as const;
const STATUSES = ['cad-derived', 'verified', 'provisional', 'unresolved'] as const;

export interface TerminationData {
  profile: typeof TERMINATION_PROFILE;
  id: string;
  label: string;
  kind: typeof KINDS[number];
  electrical_node: string | null;
  manufacturer_marking: string | null;
  designation_basis: string;
  status: typeof STATUSES[number];
  routing_eligible: boolean;
  insertion_depth_m: number | null;
  wire_capacity?: unknown;
  evidence: { source: string; source_sha256: string; feature: string; interpretation: string };
}

export interface Termination {
  node: THREE.Object3D;
  component: THREE.Object3D;
  qualifiedId: string;
  data: TerminationData;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && [...value].every(c => c.charCodeAt(0) >= 32);
}

export function parseTermination(value: unknown): TerminationData | null {
  const r = record(value);
  if (!r || r.profile !== TERMINATION_PROFILE || !text(r.id, 64) || !/^[A-Za-z0-9][A-Za-z0-9_.+-]*$/.test(r.id)
      || !text(r.label) || !KINDS.includes(r.kind as TerminationData['kind'])
      || !(text(r.electrical_node) || r.kind === 'connector' && r.electrical_node === null)
      || !(r.manufacturer_marking === null || text(r.manufacturer_marking))
      || !text(r.designation_basis) || !STATUSES.includes(r.status as TerminationData['status'])
      || typeof r.routing_eligible !== 'boolean'
      || !(r.insertion_depth_m === null || typeof r.insertion_depth_m === 'number' && Number.isFinite(r.insertion_depth_m) && r.insertion_depth_m >= 0)
      || r.routing_eligible && (r.status === 'provisional' || r.status === 'unresolved')) return null;
  const e = record(r.evidence);
  if (!e || !text(e.source, 512) || !text(e.feature, 1024) || !text(e.interpretation, 1024)
      || typeof e.source_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.source_sha256)) return null;
  return r as unknown as TerminationData;
}

export function collectTerminations(model: THREE.Object3D): { anchors: Termination[]; rejected: number } {
  model.updateWorldMatrix(true, true);
  const candidates: Termination[] = [];
  let rejected = 0;
  model.traverse(node => {
    if (!Object.hasOwn(node.userData, 'gppTermination')) return;
    const data = parseTermination(node.userData.gppTermination);
    let component = node.parent;
    while (component && !record(component.userData.gppTerminations)) component = component.parent;
    const definition = record(component?.userData.gppTerminations);
    const scale = node.getWorldScale(new THREE.Vector3());
    const x = new THREE.Vector3().setFromMatrixColumn(node.matrixWorld, 0).normalize();
    const y = new THREE.Vector3().setFromMatrixColumn(node.matrixWorld, 1).normalize();
    const z = new THREE.Vector3().setFromMatrixColumn(node.matrixWorld, 2).normalize();
    if (!data || data.status === 'unresolved' || !component || definition?.profile !== TERMINATION_PROFILE || !text(definition.component_id)
        || !node.matrixWorld.elements.every(Number.isFinite) || scale.x <= 0 || scale.y <= 0 || scale.z <= 0
        || Math.max(scale.x, scale.y, scale.z) - Math.min(scale.x, scale.y, scale.z) > 1e-6
        || Math.max(Math.abs(x.dot(y)), Math.abs(x.dot(z)), Math.abs(y.dot(z))) > 1e-6
        || node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points) {
      rejected++;
      return;
    }
    const instance: unknown = component.userData.instance_id ?? component.userData.instance_tag;
    const qualifiedId = `${text(instance) ? instance : definition.component_id}:${data.id}`;
    candidates.push({ node, component, qualifiedId, data });
  });
  // Ambiguous IDs within a component invalidate every occurrence, not just the last one.
  const counts = new Map<string, number>();
  for (const a of candidates) {
    const key = `${a.component.uuid}:${a.data.id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const anchors = candidates.filter(a => counts.get(`${a.component.uuid}:${a.data.id}`) === 1);
  return { anchors, rejected: rejected + candidates.length - anchors.length };
}

export function terminationFrame(anchor: Termination): { point: THREE.Vector3; outward: THREE.Vector3 } {
  anchor.node.updateWorldMatrix(true, false);
  return {
    point: anchor.node.getWorldPosition(new THREE.Vector3()),
    outward: new THREE.Vector3(0, 0, 1).transformDirection(anchor.node.matrixWorld),
  };
}

/** Use the same frames as the overlay; never substitute a guessed geometry point. */
export function resolveTermination(model: THREE.Object3D, qualifiedId: string, wire?: WireEnd, occupiedConductors = 0): ReturnType<typeof terminationFrame> {
  const matches = collectTerminations(model).anchors.filter(a => a.qualifiedId === qualifiedId);
  if (matches.length !== 1) throw new Error(`Unresolved or ambiguous termination: ${qualifiedId}`);
  if (!matches[0].data.routing_eligible) throw new Error(`Termination is not routing eligible: ${qualifiedId}`);
  if (wire) {
    const scale = matches[0].node.getWorldScale(new THREE.Vector3());
    if ([scale.x, scale.y, scale.z].some(v => Math.abs(v - 1) > 1e-6)) throw new Error(`Sized routing requires unit physical scale: ${qualifiedId}`);
    const check = checkWireCapacity(matches[0].data.wire_capacity, wire, occupiedConductors);
    if (check.status !== 'compatible') throw new Error(`Wire capacity ${check.status}: ${qualifiedId}: ${check.reasons.join('; ')}`);
  }
  return terminationFrame(matches[0]);
}

/** Key occupancy by physical clamp, including alternate mouths of the same clamp. */
export function terminationClampKey(anchor: Termination): string {
  const local = parseWireCapacity(anchor.data.wire_capacity)?.shared_clamp_id ?? anchor.data.id;
  return `${anchor.qualifiedId.slice(0, anchor.qualifiedId.lastIndexOf(':'))}:${local}`;
}

/** Both end preparations may differ, but the continuous conductor must match. */
export function resolveWireTerminations(model: THREE.Object3D, from: string, to: string, fromWire: WireEnd,
  toWire: WireEnd = fromWire, occupancy: ReadonlyMap<string, number> = new Map()): { from: ReturnType<typeof terminationFrame>; to: ReturnType<typeof terminationFrame> } {
  if (fromWire.area_mm2 !== toWire.area_mm2 || fromWire.material !== toWire.material || fromWire.conductor_count !== toWire.conductor_count) {
    throw new Error('Both ends must describe the same conductor');
  }
  const anchors = collectTerminations(model).anchors;
  const keys = [from, to].map(id => {
    const matches = anchors.filter(a => a.qualifiedId === id);
    if (matches.length !== 1) throw new Error(`Unresolved or ambiguous termination: ${id}`);
    return terminationClampKey(matches[0]);
  });
  if (keys[0] === keys[1]) throw new Error('Two wire ends cannot occupy the same single-conductor clamp');
  return { from: resolveTermination(model, from, fromWire, occupancy.get(keys[0]) ?? 0),
    to: resolveTermination(model, to, toWire, occupancy.get(keys[1]) ?? 0) };
}

interface Marker { anchor: Termination; group: THREE.Group; label: HTMLButtonElement; tip: THREE.Vector3; leader: SVGLineElement }
interface LabelBox { x: number; y: number; halfWidth: number; halfHeight: number }

/** Runtime-only helpers live outside the model so they cannot affect physical bounds. */
export class TerminationOverlay {
  readonly group = new THREE.Group();
  readonly element: HTMLDivElement;
  private detail: HTMLDivElement;
  private markers: Marker[] = [];
  private shown = false;
  private host: HTMLElement;
  private invalidate: () => void;

  constructor(host: HTMLElement, anchors: Termination[], invalidate: () => void) {
    this.host = host;
    this.invalidate = invalidate;
    this.group.name = 'Engiware termination overlay';
    this.group.visible = false;
    this.element = host.createDiv({ cls: 'engiware-termination-overlay' });
    this.element.hidden = true;
    const leaders = this.element.createSvg('svg');
    leaders.classList.add('engiware-termination-leaders');
    leaders.setAttribute('aria-hidden', 'true');
    this.detail = this.element.createDiv({ cls: 'engiware-termination-detail' });
    this.detail.setAttribute('role', 'status');
    this.detail.setAttribute('aria-live', 'polite');
    this.detail.textContent = 'Termination guides · arrows point outward · select a label for evidence. Guides are visible through surfaces.';
    for (const anchor of anchors) {
      const color = anchor.data.status === 'provisional' || anchor.data.status === 'unresolved' ? 0xb56512 : 0x087f8c;
      const group = new THREE.Group();
      const material = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false });
      const target = new THREE.Mesh(new THREE.SphereGeometry(0.00065, 12, 8), material);
      target.renderOrder = 100;
      group.add(target);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.010, color, 0.0025, 0.0018);
      for (const part of [arrow.line, arrow.cone]) {
        part.geometry = part.geometry.clone();
        part.renderOrder = 100;
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        for (const m of materials) { m.depthTest = false; m.depthWrite = false; m.toneMapped = false; }
      }
      group.add(arrow);
      this.group.add(group);
      const label = this.element.createEl('button');
      label.type = 'button';
      label.className = 'engiware-termination-label';
      label.dataset.status = anchor.data.status;
      const instance: unknown = anchor.component.userData.instance_id ?? anchor.component.userData.instance_tag;
      label.textContent = (text(instance) ? `${instance}:${anchor.data.id}` : anchor.data.id) + (anchor.data.status === 'provisional' ? ' ?' : '');
      label.setAttribute('aria-label', `${anchor.qualifiedId}: ${anchor.data.label}, ${anchor.data.status}`);
      label.setAttribute('aria-pressed', 'false');
      label.title = `${anchor.qualifiedId} · ${anchor.data.kind} · ${anchor.data.status}`;
      label.addEventListener('click', () => {
        for (const marker of this.markers) marker.label.setAttribute('aria-pressed', String(marker.anchor === anchor));
        this.describe(anchor);
        this.invalidate();
      });
      this.element.append(label);
      const leader = leaders.createSvg('line');
      leader.setAttribute('stroke', `#${color.toString(16).padStart(6, '0')}`);
      this.markers.push({ anchor, group, label, tip: new THREE.Vector3(), leader });
    }
  }

  get visible(): boolean { return this.shown; }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.group.visible = visible;
    this.element.hidden = !visible;
    this.invalidate();
  }

  private describe(anchor: Termination): void {
    const { data } = anchor;
    const position = anchor.node.position.toArray().map(v => (v * 1000).toFixed(3)).join(', ');
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(anchor.node.quaternion).toArray().map(v => v.toFixed(3)).join(', ');
    this.detail.textContent = `${anchor.qualifiedId} · ${data.label}\n${data.kind} · ${data.status} · geometry routing ${data.routing_eligible ? 'eligible' : 'ineligible'} · ${data.electrical_node === null ? 'multi-contact interface' : `electrical node ${data.electrical_node}`}\nParent-local entry [${position}] mm · outward [${direction}]\n${describeWireCapacity(data.wire_capacity)}\nGeometry evidence: ${data.evidence.feature}. ${data.evidence.interpretation}`;
  }

  update(camera: THREE.Camera): void {
    if (!this.shown) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    const pending: { marker: Marker; x: number; y: number }[] = [];
    for (const marker of this.markers) {
      const { point, outward } = terminationFrame(marker.anchor);
      marker.group.position.copy(point);
      marker.group.quaternion.copy(marker.anchor.node.getWorldQuaternion(new THREE.Quaternion()));
      marker.tip.copy(point).addScaledVector(outward, 0.012).project(camera);
      const p = marker.tip;
      const origin = point.clone().project(camera);
      // A small component can fit while its fixed-length arrow tip is offscreen.
      // Keep the label available whenever the physical connection is in view.
      marker.label.hidden = origin.z < -1 || origin.z > 1 || Math.abs(origin.x) > 1.1 || Math.abs(origin.y) > 1.1;
      marker.leader.setAttribute('visibility', 'hidden');
      if (!marker.label.hidden) {
        if (p.z < -1 || p.z > 1) p.copy(origin);
        pending.push({ marker, x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 });
      }
    }
    const occupied: LabelBox[] = [{ x: this.detail.offsetLeft + this.detail.offsetWidth / 2,
      y: this.detail.offsetTop + this.detail.offsetHeight / 2,
      halfWidth: this.detail.offsetWidth / 2, halfHeight: this.detail.offsetHeight / 2 }];
    // Pack from top to bottom with short leaders. Geometry and frame positions
    // remain exact; only screen-space labels move to avoid obscuring one another.
    for (const { marker, x, y } of pending.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const halfWidth = marker.label.offsetWidth / 2, halfHeight = marker.label.offsetHeight / 2;
      const clamp = (cx: number, cy: number): LabelBox => ({
        x: Math.max(halfWidth + 6, Math.min(width - halfWidth - 6, cx)),
        y: Math.max(halfHeight + 6, Math.min(height - halfHeight - 6, cy)), halfWidth, halfHeight,
      });
      const fits = (box: LabelBox) => occupied.every(other => Math.abs(box.x - other.x) >= halfWidth + other.halfWidth + 4
        || Math.abs(box.y - other.y) >= halfHeight + other.halfHeight + 4);
      const distance = (box: LabelBox) => (box.x - x) ** 2 + (box.y - y) ** 2;
      const desired = clamp(x, y);
      const candidates = [desired];
      if (!fits(desired)) {
        for (const other of occupied) candidates.push(clamp(x, other.y - other.halfHeight - halfHeight - 4),
          clamp(x, other.y + other.halfHeight + halfHeight + 4),
          clamp(other.x - other.halfWidth - halfWidth - 4, y), clamp(other.x + other.halfWidth + halfWidth + 4, y));
      }
      let box = candidates.sort((a, b) => distance(a) - distance(b)).find(fits);
      if (!box) {
        const grid: LabelBox[] = [];
        for (let cy = halfHeight + 6; cy <= height - halfHeight - 6; cy += halfHeight * 2 + 4) {
          for (let cx = halfWidth + 6; cx <= width - halfWidth - 6; cx += halfWidth * 2 + 4) grid.push(clamp(cx, cy));
        }
        box = grid.sort((a, b) => distance(a) - distance(b)).find(fits) ?? desired;
      }
      occupied.push(box);
      marker.label.style.setProperty('--termination-x', `${box.x}px`);
      marker.label.style.setProperty('--termination-y', `${box.y}px`);
      if (distance(box) > 16) {
        marker.leader.setAttribute('x1', String(x)); marker.leader.setAttribute('y1', String(y));
        marker.leader.setAttribute('x2', String(box.x)); marker.leader.setAttribute('y2', String(box.y));
        marker.leader.setAttribute('visibility', 'visible');
      }
    }
  }

  dispose(): void {
    const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.group.traverse(node => {
      if (!(node instanceof THREE.Mesh || node instanceof THREE.Line)) return;
      const object = node as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
      geometry.add(object.geometry);
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m);
    });
    geometry.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    this.group.removeFromParent();
    this.element.remove();
    this.markers = [];
  }
}
