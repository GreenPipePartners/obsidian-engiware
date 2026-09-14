import test from 'node:test';
import assert from 'node:assert/strict';
import { requestGraphicsContext } from '../src/graphics.ts';

function fixture(getContext) {
  const attempts = [];
  const canvases = new Set();
  const controller = new AbortController();
  const host = {
    createEl() {
      const canvas = {
        getContext(type, attributes) {
          assert.equal(type, 'webgl2');
          attempts.push(attributes);
          return getContext(attributes);
        },
        remove() { canvases.delete(canvas); },
      };
      canvases.add(canvas);
      return canvas;
    },
  };
  const options = { host, signal: controller.signal, maxDimension: 960 };
  return { attempts, canvases, controller, options };
}

test('normal graphics succeed without requesting compatibility confirmation', async () => {
  const context = {};
  const f = fixture(() => context);
  const result = await requestGraphicsContext({ ...f.options, confirmCompatibility: () => assert.fail('Unexpected confirmation') });
  assert.equal(result.context, context);
  assert.equal(result.compatibilityMode, false);
  assert.equal(f.attempts.length, 1);
  assert.equal(f.canvases.size, 1);
});

test('a failed standard attempt waits for approval before trying reduced-quality graphics', async () => {
  const context = {};
  const f = fixture(attributes => attributes.failIfMajorPerformanceCaveat ? null : context);
  const choice = Promise.withResolvers();
  let confirmations = 0;
  const result = requestGraphicsContext({
    ...f.options,
    confirmCompatibility: () => { confirmations++; return choice.promise; },
  });
  assert.equal(confirmations, 1);
  assert.equal(f.attempts.length, 1);
  assert.equal(f.canvases.size, 0, 'no canvas should remain while waiting');
  choice.resolve(true);
  const graphics = await result;
  assert.equal(graphics.context, context);
  assert.equal(graphics.compatibilityMode, true);
  assert.equal(f.attempts.length, 2);
  assert.equal(f.attempts[1].failIfMajorPerformanceCaveat, false);
  assert.equal(f.attempts[1].antialias, false);
  assert.equal(f.canvases.size, 1);
});

test('keeping the image creates no fallback context and retains no canvas', async () => {
  const f = fixture(() => null);
  await assert.rejects(requestGraphicsContext({ ...f.options, confirmCompatibility: async () => false }), { name: 'AbortError' });
  assert.equal(f.attempts.length, 1);
  assert.equal(f.canvases.size, 0);
});

test('an already closed preview performs no graphics work', async () => {
  const f = fixture(() => assert.fail('Graphics attempted after close'));
  f.controller.abort();
  await assert.rejects(requestGraphicsContext({ ...f.options, confirmCompatibility: () => assert.fail('Prompted after close') }), { name: 'AbortError' });
  assert.equal(f.canvases.size, 0);
});

test('late confirmation after closing a preview cannot start fallback graphics', async () => {
  const f = fixture(() => null);
  const choice = Promise.withResolvers();
  const result = requestGraphicsContext({ ...f.options, confirmCompatibility: () => choice.promise });
  f.controller.abort();
  choice.resolve(true);
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(f.attempts.length, 1);
  assert.equal(f.canvases.size, 0);
});

test('genuine WebGL unavailability is reported only after the confirmed retry also fails', async () => {
  const f = fixture(() => null);
  await assert.rejects(requestGraphicsContext({ ...f.options, confirmCompatibility: async () => true }), /could not create a WebGL 2 context, even in reduced-quality mode/);
  assert.equal(f.attempts.length, 2);
  assert.equal(f.canvases.size, 0);
});

test('a browser context exception does not leave a canvas attached', async () => {
  const f = fixture(() => { throw new Error('Context creation failed'); });
  await assert.rejects(requestGraphicsContext({ ...f.options, confirmCompatibility: () => assert.fail('Unexpected confirmation') }), /Context creation failed/);
  assert.equal(f.canvases.size, 0);
});
