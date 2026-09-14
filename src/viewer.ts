import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { EngiwareSettings } from './config';
import { requestGraphicsContext } from './graphics';

export interface ViewerMetrics {
  opens: number;
  modelReads: number;
  contextsCreated: number;
  activeViewers: number;
  frames: number;
  lastCamera?: number[];
  lastModelSize?: number[];
  lastDrawMs?: number;
  depthBits?: number;
  lastRenderMode?: 'standard' | 'compatibility';
}

export interface ViewerHandle { dispose(): void; reset(): void; }

interface Options {
  host: HTMLElement;
  signal: AbortSignal;
  settings: EngiwareSettings;
  metrics: ViewerMetrics;
  readModel(): Promise<ArrayBuffer>;
  confirmCompatibility(): Promise<boolean>;
  onReady(compatibilityMode: boolean): void;
  onSlowRender(): void;
  onFallback(reason: string): void;
}

export async function createViewer(options: Options): Promise<ViewerHandle> {
  const { host, signal, settings, metrics } = options;
  const doc = host.ownerDocument;
  const win = doc.defaultView!;
  if (signal.aborted) throw new DOMException('Closed', 'AbortError');
  const { canvas, context, compatibilityMode } = await requestGraphicsContext({
    host, signal, maxDimension: settings.maxDimension,
    confirmCompatibility: () => options.confirmCompatibility(),
  });
  if (signal.aborted) {
    context.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
    throw new DOMException('Closed', 'AbortError');
  }

  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, stencil: true }); }
  catch (error) {
    context.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
    throw error;
  }
  metrics.contextsCreated++;
  metrics.activeViewers++;
  metrics.lastRenderMode = compatibilityMode ? 'compatibility' : 'standard';
  const depthBits: unknown = context.getParameter(context.DEPTH_BITS);
  metrics.depthBits = typeof depthBits === 'number' ? depthBits : undefined;
  renderer.setPixelRatio(1);
  renderer.setClearColor('#e4e9ed', 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = false;
  canvas.setAttribute('aria-label', 'Interactive component model');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.001, 10);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.autoRotate = false;
  controls.enabled = false;
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(-2, 4, 5);
  scene.add(light, new THREE.HemisphereLight(0xffffff, 0x9ba9b5, 1.3));

  let model: THREE.Object3D | null = null;
  let environment: THREE.WebGLRenderTarget | null = null;
  let sphere: THREE.Sphere | null = null;
  let disposed = false, ready = false, firstFrame = true, dirty = true, warnedSlow = false;
  let frame = 0, timer = 0, lastDraw = 0, slowFrames = 0;
  let renderLimit = compatibilityMode ? Math.min(640, settings.maxDimension) : settings.maxDimension;
  let frameLimit = compatibilityMode ? Math.min(10, settings.maxFps) : settings.maxFps;
  const cancel = () => { win.cancelAnimationFrame(frame); win.clearTimeout(timer); frame = timer = 0; };
  const invalidate = () => { dirty = true; schedule(); };

  function schedule(): void {
    if (disposed || !ready || !dirty || frame || timer || doc.visibilityState !== 'visible' || !host.isConnected) return;
    timer = win.setTimeout(() => {
      timer = 0;
      frame = win.requestAnimationFrame(draw);
    }, Math.max(0, 1000 / frameLimit - (win.performance.now() - lastDraw)));
  }

  function fallback(reason: string): void {
    dispose();
    options.onFallback(reason);
  }

  function draw(): void {
    frame = 0;
    if (disposed || signal.aborted || doc.visibilityState !== 'visible') return;
    dirty = false;
    try {
      // Keep depth precision around the actual component, including its thin print.
      if (sphere) {
        const distance = camera.position.distanceTo(sphere.center);
        camera.near = Math.max(sphere.radius * 0.01, distance - sphere.radius * 1.3);
        camera.far = Math.max(camera.near + sphere.radius * 2, distance + sphere.radius * 2);
        camera.updateProjectionMatrix();
      }
      const start = win.performance.now();
      renderer.render(scene, camera);
      const elapsed = win.performance.now() - start;
      metrics.frames++;
      metrics.lastDrawMs = elapsed;
      metrics.lastCamera = camera.position.toArray();
      lastDraw = win.performance.now();
      if (firstFrame) {
        firstFrame = false;
        canvas.removeClass('is-loading');
        controls.enabled = true;
        options.onReady(compatibilityMode);
      } else if (elapsed > 80) {
        frameLimit = Math.min(10, frameLimit);
        if (renderLimit > 640) { renderLimit = 640; resize(); }
        if (++slowFrames >= 2 && !warnedSlow) {
          warnedSlow = true;
          options.onSlowRender();
        }
      } else slowFrames = 0;
      schedule();
    } catch { fallback('The 3D renderer could not finish this view.'); }
  }

  function resize(): void {
    if (disposed) return;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const ratio = Math.min(1, renderLimit / Math.max(width, height));
    const renderWidth = Math.max(1, Math.round(width * ratio));
    const renderHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width === renderWidth && canvas.height === renderHeight && camera.aspect === width / height) return;
    renderer.setSize(renderWidth, renderHeight, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  }

  function reset(): void {
    if (!sphere || disposed) return;
    const angle = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
    const distance = sphere.radius / Math.sin(angle) * 1.06;
    camera.near = Math.max(sphere.radius / 1000, 0.000001);
    camera.far = sphere.radius * 100;
    camera.position.copy(sphere.center).add(new THREE.Vector3(-0.48, 0.4, 1).normalize().multiplyScalar(distance));
    camera.updateProjectionMatrix();
    controls.target.copy(sphere.center);
    controls.minDistance = sphere.radius * 0.2;
    controls.maxDistance = sphere.radius * 50;
    controls.update();
    invalidate();
  }

  const resized = new ResizeObserver(resize);
  const visibilityChanged = () => { if (doc.visibilityState === 'visible') schedule(); else cancel(); };
  const contextLost = (event: Event) => {
    event.preventDefault();
    if (!disposed) fallback('The 3D graphics context was lost.');
  };
  controls.addEventListener('change', invalidate);
  resized.observe(host);
  doc.addEventListener('visibilitychange', visibilityChanged);
  canvas.addEventListener('webglcontextlost', contextLost);
  signal.addEventListener('abort', dispose, { once: true });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancel();
    controls.removeEventListener('change', invalidate);
    controls.dispose();
    resized.disconnect();
    doc.removeEventListener('visibilitychange', visibilityChanged);
    canvas.removeEventListener('webglcontextlost', contextLost);
    signal.removeEventListener('abort', dispose);
    if (model) disposeObject(model);
    environment?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    metrics.activeViewers--;
  }

  try {
    const bytes = await options.readModel();
    if (signal.aborted) throw new DOMException('Closed', 'AbortError');
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
      if (url.startsWith('data:') || url.startsWith('blob:')) return url;
      throw new Error('Use a self-contained GLB with embedded resources.');
    });
    const gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
    if (disposed || signal.aborted) {
      disposeObject(gltf.scene);
      throw new DOMException('Closed', 'AbortError');
    }
    model = gltf.scene;
    scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) throw new Error('The model has no displayable geometry.');
    metrics.lastModelSize = box.getSize(new THREE.Vector3()).toArray();
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(renderer);
    try { environment = generator.fromScene(room, 0.04, 0.1, 100, { size: compatibilityMode ? 64 : 128 }); }
    finally { room.dispose(); generator.dispose(); }
    scene.environment = environment.texture;
    scene.environmentIntensity = 1;
    resize();
    reset();
    ready = true;
    invalidate();
    return { dispose, reset };
  } catch (error) {
    dispose();
    throw error;
  }
}

function disposeObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      materials.add(material);
      Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); });
    }
  });
  textures.forEach(texture => {
    texture.dispose();
    const source: unknown = texture.source.data;
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
  });
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}
