import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { inspectSpark } from '../src/engispark.ts';
import { PerspectiveRuntime, property } from '../src/perspective-runtime.ts';
import { sha256 } from '../src/engibook.ts';
import { rebaseComponentText } from '../src/deployment.ts';

const directory = await mkdtemp(join(tmpdir(), 'engiware-spark-'));
const archivePath = join(directory, 'sample.engispark');
execFileSync('python3', ['-B', 'scripts/package_engispark.py', '--output', archivePath]);
const bytes = new Uint8Array(await readFile(archivePath));
test.after(() => rm(directory, { recursive: true, force: true }));
const tag = '[default]Engispark/PS1_DC_OK';
const provenance = JSON.parse(await readFile('examples/1606-xle240e-dc-ok/artwork-provenance.json', 'utf8'));
const named = (runtime, name) => [...runtime.nodes.values()].find(node => node.meta?.name === name);
const lamp = runtime => property(named(runtime, 'ComponentDrawing'), provenance.bindingTargets.fill);
const caption = runtime => property(named(runtime, 'DcOkText'), 'props.text');

test('packages the native view verbatim with separate native tags and deterministic bytes', async () => {
  const spark = await inspectSpark(bytes);
  const native = unzipSync(spark.files[spark.manifest.ignition.project]);
  const viewPath = `com.inductiveautomation.perspective/views/${spark.manifest.ignition.viewPath}/view.json`;
  const source = new Uint8Array(await readFile('examples/1606-xle240e-dc-ok/view.json'));
  assert.deepEqual(native[viewPath], source);
  assert.equal(spark.viewSha256, await sha256(source));
  assert.deepEqual(Object.keys(native).sort(), ['project.json', viewPath, viewPath.replace('view.json', 'resource.json')].sort());
  const tags = JSON.parse(new TextDecoder().decode(spark.files[spark.manifest.ignition.tags]));
  assert.deepEqual(tags.tags[0].tags, [{ name: 'PS1_DC_OK', tagType: 'AtomicTag', dataType: 'Boolean', valueSource: 'memory', value: true }]);
  assert.equal(JSON.stringify(spark.view).match(/"type":"tag"/g).length, 1, 'one tag binding in the native view');
  assert.deepEqual(spark.files['artwork/1606-XLE240E-panel.svg'], new Uint8Array(await readFile('examples/1606-xle240e-dc-ok/1606-XLE240E-panel.svg')));
  execFileSync('python3', ['-B', 'scripts/package_engispark.py', '--output', archivePath]);
  assert.deepEqual(new Uint8Array(await readFile(archivePath)), bytes);
});

test('native checkbox writes through the property binding and indirect tag binding, updating both map transforms', async () => {
  const spark = await inspectSpark(bytes);
  const source = JSON.stringify(spark.view);
  const runtime = new PerspectiveRuntime(spark.view, spark.manifest.simulation.tags);
  const other = new PerspectiveRuntime(spark.view, spark.manifest.simulation.tags);
  let notifications = 0;
  runtime.subscribe(() => notifications++);
  assert.equal(lamp(runtime), '#9bdc89');
  assert.equal(caption(runtime), 'DC OK');
  runtime.writeProperty('root/1/2', 'props.selected', false);
  assert.equal(runtime.tags.readBlocking([tag])[0].value, false);
  assert.equal(lamp(runtime), '#ef4444');
  assert.equal(caption(runtime), 'DC NOT OK');
  assert.equal(lamp(other), '#9bdc89', 'sample instances do not share tags');
  runtime.setTag(tag, true);
  assert.equal(property(named(runtime, 'DcOkToggle'), 'props.selected'), true);
  runtime.writeProperty('root/1/2', 'props.selected', false);
  runtime.reset();
  assert.equal(lamp(runtime), '#9bdc89');
  assert.equal(notifications, 4);
  runtime.dispose();
  runtime.setTag(tag, false);
  assert.equal(notifications, 4, 'closing detaches subscribers');
  other.dispose();
  assert.equal(JSON.stringify(spark.view), source, 'evaluation never mutates the imported source');
});

test('changing native colors and parameters changes the sample without package-specific code', async () => {
  const spark = await inspectSpark(bytes);
  spark.view.params.tagPath = '[sim]Different/Boolean';
  spark.view.root.children[0].propConfig[provenance.bindingTargets.fill].binding.transforms[0].mappings[1].output = '#aa1122';
  const runtime = new PerspectiveRuntime(spark.view, [{ path: '[sim]Different/Boolean', dataType: 'Boolean', value: false }]);
  assert.equal(lamp(runtime), '#aa1122');
  assert.equal(property(named(runtime, 'TagPath'), 'props.text'), '[sim]Different/Boolean');
  runtime.writeProperty('root/1/2', 'props.selected', true);
  assert.equal(runtime.tags.readBlocking(['[sim]Different/Boolean'])[0].value, true);
  assert.throws(() => runtime.writeProperty('root/1/3', 'props.text', 'override'), /read-only/);
  assert.throws(() => runtime.setTag(tag, false), /Bad_DoesNotExist/);
  runtime.dispose();
});

test('unresolved tags use native map fallbacks and refuse writes rather than faking a healthy Boolean', async () => {
  const spark = await inspectSpark(bytes);
  spark.view.params.tagPath = '[default]Missing';
  const runtime = new PerspectiveRuntime(spark.view, spark.manifest.simulation.tags);
  assert.equal(lamp(runtime), '#94a3b8');
  assert.equal(caption(runtime), 'DC status unavailable');
  assert.equal(runtime.tags.readBlocking(['[default]Missing'])[0].quality, 'Bad_DoesNotExist');
  assert.throws(() => runtime.writeProperty('root/1/2', 'props.selected', true), /Bad_DoesNotExist/);
  runtime.dispose();
});

async function altered(edit) {
  const files = unzipSync(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['engispark.json']));
  await edit(files, manifest);
  files['engispark.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

test('rejects corrupt inventory, extra files, traversal, excessive expansion and cancelled loads', async () => {
  await assert.rejects(inspectSpark(await altered(files => { files['README.md'][0] ^= 1; })), /checksum/);
  await assert.rejects(inspectSpark(await altered(files => { files['extra.txt'] = strToU8('undeclared'); })), /undeclared/);
  await assert.rejects(inspectSpark(await altered(files => { files['../escape'] = strToU8('bad'); })), /Invalid/);
  await assert.rejects(inspectSpark(await altered(files => { files['large'] = new Uint8Array(17 * 1024 * 1024); })), /oversized/);
  await assert.rejects(inspectSpark(await altered(files => { files['readme.md'] = files['README.md']; })), /Invalid/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(inspectSpark(bytes, abort.signal), { name: 'AbortError' });
});

test('refuses unsupported native behavior instead of rendering a partial imitation', async () => {
  const spark = await inspectSpark(bytes);
  for (const mutate of [
    view => { view.root.children[0].type = 'ia.display.chart'; },
    view => { view.propConfig['custom.dcOk'].binding = { type: 'expr', config: { expression: 'true' } }; },
    view => { view.root.events = { onClick: { script: 'pass' } }; },
    view => { view.root.props.style.classes = 'External/Class'; },
    view => { view.root.props.style.backgroundColor = 'url(https://example.com/remote)'; },
    view => { view.propConfig['custom.dcOk'].binding.transforms = [{ type: 'script', code: 'return value' }]; },
    view => { view.root.propConfig = { 'props.__proto__.polluted': { binding: { type: 'property', config: { path: 'view.custom.dcOk' } } } }; },
    view => { view.root.children[0].props.elements[0].type = 'script'; },
    view => { view.root.children[0].props.elements[0].href = 'https://example.com/remote.svg'; },
  ]) {
    const view = structuredClone(spark.view);
    mutate(view);
    assert.throws(() => new PerspectiveRuntime(view, spark.manifest.simulation.tags), /Unsupported|require/);
  }
  assert.equal({}.polluted, undefined);
});

test('tag changes only the original SVG lamp paints; all paths, transforms and component labels are retained', async () => {
  const spark = await inspectSpark(bytes);
  const runtime = new PerspectiveRuntime(spark.view, spark.manifest.simulation.tags);
  const drawing = named(runtime, 'ComponentDrawing');
  assert.equal(drawing.type, 'ia.shapes.svg');
  const initial = structuredClone(drawing.props.elements);
  const before = [];
  const walk = (items, out) => { for (const item of items) { out.push(item); walk(item.elements ?? [], out); } };
  walk(initial, before);
  const source = JSON.parse(execFileSync('python3', ['-B', '-c', `import json,xml.etree.ElementTree as E
r=E.parse('examples/1606-xle240e-dc-ok/1606-XLE240E-panel.svg').getroot()
print(json.dumps({'paths':[e.get('d') for e in r.iter() if e.tag.endswith('}path')], 'transforms':[e.get('transform') for e in r.iter() if e.get('transform')], 'labels':[e.text for e in r.iter() if e.tag.endswith('}text')]}))`], { encoding: 'utf8' }));
  assert.deepEqual(before.filter(item => item.type === 'path').map(item => item.d), source.paths);
  assert.deepEqual(before.filter(item => item.transform).map(item => item.transform), source.transforms);
  assert.deepEqual(before.filter(item => item.type === 'text').map(item => item.text), source.labels);
  const originalLamp = before.find(item => item.name === 'dc-ok-lamp-fill');
  assert.equal(originalLamp.fill.paint, '#9bdc89');
  runtime.setTag(tag, false);
  const after = [];
  walk(structuredClone(drawing.props.elements), after);
  const changed = before.flatMap((item, index) => JSON.stringify(item) === JSON.stringify(after[index]) ? [] : [item.name ?? item.type]);
  assert.deepEqual(changed, ['group', 'dc-ok-lamp-fill', 'dc-ok-lamp-outline'], 'only the lamp and its containing group differ');
  after.find(item => item.name === 'dc-ok-lamp-fill').fill.paint = '#9bdc89';
  after.find(item => item.name === 'dc-ok-lamp-outline').stroke.paint = '#86bd7a';
  assert.deepEqual(after, before, 'all non-lamp artwork and geometry remain identical');
  assert.equal(provenance.sourceElementId, '861f0e79');
  runtime.dispose();
});

test('deployment rebases the Engispark code block but preserves nested native project bytes', () => {
  const id = 'AB_1606-XLE240E';
  const manifest = { entrypoint: `${id}.md`, assetRoot: `Assets/${id}` };
  const path = `Assets/${id}/schematic/DC_OK.engispark`;
  const note = strToU8('```engispark\npackage: ' + path + '\n```');
  const rewritten = rebaseComponentText(note, manifest.entrypoint, manifest.assetRoot, manifest.entrypoint, 'Library/Components');
  assert.match(new TextDecoder().decode(rewritten), /package: Library\/Components\/Assets\//);
  assert.deepEqual(rebaseComponentText(bytes, path, manifest.assetRoot, manifest.entrypoint, 'Library/Components'), bytes);
});
