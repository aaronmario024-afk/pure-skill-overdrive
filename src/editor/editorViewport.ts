import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { buildAssetMesh, buildPrefabPreviewGroup, getAssetDefinition } from './assetCatalog';
import { applyCustomLightingToScene } from './customMapBuilder';
import { buildNavMeshOverlay, CustomNavBakeResult, extractObjectColliderBoxes } from './navAndValidation';
import { createUniqueId, deepClone } from './presets';
import {
  applyTerrainBrush,
  buildTerrainMesh,
  sampleMapSurfaceHeight,
  syncTerrainGeometry,
  TerrainBrushMode,
  TerrainFalloffMode,
} from './terrain';
import { CustomMapDocument, EditorCameraState, MapObject, PrefabDef } from './types';

export type EditorToolMode = 'select' | 'translate' | 'rotate' | 'scale' | 'place' | 'terrain';

export interface SnapConfig {
  enabled: boolean;
  translateStep: number;
  rotateStepDeg: number;
  scaleStep: number;
}

export interface TerrainToolSettings {
  mode: TerrainBrushMode;
  radius: number;
  strength: number;
  falloff: TerrainFalloffMode;
  smoothness: number;
  targetHeight: number;
}

export interface PlacementPayload {
  kind: 'asset' | 'prefab';
  assetId?: string;
  prefab?: PrefabDef;
}

export interface EditorViewportCallbacks {
  onSelectIds: (ids: string[], append: boolean) => void;
  onObjectsTransformed: (label: string, beforeDoc: CustomMapDocument) => void;
  onPlaceRequested: (items: MapObject[]) => void;
  onTerrainChanged: (beforeHeights: number[], afterHeights: number[]) => void;
  onPlacementCancelled: () => void;
  onStatusUpdate: (statusText: string) => void;
}

export class EditorViewport {
  private container: HTMLElement;
  private callbacks: EditorViewportCallbacks;
  private doc: CustomMapDocument;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private perspCam: THREE.PerspectiveCamera;
  private orthoCam: THREE.OrthographicCamera;
  private activeCam: THREE.Camera;
  private viewMode: 'perspective' | 'topdown' = 'perspective';

  private orbit: OrbitControls;
  private transform: TransformControls;
  private transformHelper: THREE.Object3D;

  private worldGroup = new THREE.Group();
  private objectMeshes = new Map<string, THREE.Group>();
  private selectionGroup = new THREE.Group();
  private lightHandlesGroup = new THREE.Group();
  private lightingDispose: (() => void) | null = null;
  private terrainMesh: THREE.Mesh | null = null;
  private gridHelper: THREE.GridHelper;
  private boundaryHelper: THREE.Group | null = null;
  private navOverlay: THREE.Group | null = null;

  private multiPivot = new THREE.Group();
  private multiPivotStartMatrices = new Map<string, { pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3 }>();

  // Raycast & placement
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private groundFallbackPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private toolMode: EditorToolMode = 'select';
  private snap: SnapConfig = { enabled: true, translateStep: 0.5, rotateStepDeg: 15, scaleStep: 0.1 };
  private terrainSettings: TerrainToolSettings = {
    mode: 'raise',
    radius: 4.5,
    strength: 0.35,
    falloff: 'smooth',
    smoothness: 0.5,
    targetHeight: 0,
  };

  private placementPayload: PlacementPayload | null = null;
  private previewGroup: THREE.Group | null = null;
  private previewYawDeg = 0;
  private previewScaleMult = 1;
  private previewValid = false;
  private previewPos = new THREE.Vector3();

  private brushRing: THREE.Mesh;
  private sculpting = false;
  private sculptBeforeHeights: number[] | null = null;
  private slopeStartPt: [number, number, number] | null = null;

  private selectedIds: string[] = [];
  private beforeTransformDoc: CustomMapDocument | null = null;

  // Navigation state (RMB free-fly)
  private flyHeld = false;
  private lastMouse = { x: 0, y: 0 };
  private flyKeys = new Set<string>();
  private rafId = 0;
  private lastFrameMs = 0;
  private fpsAvg = 60;
  private disposed = false;

  // Helpers visibility
  private showGrid = true;
  private showBoundaries = true;
  private showNavMesh = false;
  private lastBake: CustomNavBakeResult | null = null;

  private resizeObserver: ResizeObserver;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerUpBound: (e: PointerEvent) => void;
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onContextMenuBound: (e: MouseEvent) => void;

  constructor(container: HTMLElement, doc: CustomMapDocument, callbacks: EditorViewportCallbacks, initialCam?: EditorCameraState) {
    this.container = container;
    this.doc = doc;
    this.callbacks = callbacks;

    const w = Math.max(320, container.clientWidth || window.innerWidth);
    const h = Math.max(240, container.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'ed-webgl-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.perspCam = new THREE.PerspectiveCamera(62, w / h, 0.1, 500);
    const orthoHalf = Math.max(doc.dimensions.width, doc.dimensions.depth) * 0.65;
    const aspect = w / h;
    this.orthoCam = new THREE.OrthographicCamera(-orthoHalf * aspect, orthoHalf * aspect, orthoHalf, -orthoHalf, 0.5, 300);
    this.orthoCam.position.set(0, 90, 0);
    this.orthoCam.up.set(0, 0, -1);
    this.orthoCam.lookAt(0, 0, 0);

    if (initialCam) {
      this.perspCam.position.set(...initialCam.position);
      this.viewMode = initialCam.viewMode;
    } else {
      this.perspCam.position.set(0, Math.max(18, doc.dimensions.depth * 0.42), Math.max(22, doc.dimensions.depth * 0.55));
    }
    this.activeCam = this.viewMode === 'topdown' ? this.orthoCam : this.perspCam;

    this.orbit = new OrbitControls(this.perspCam, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.minDistance = 1.5;
    this.orbit.maxDistance = 220;
    this.orbit.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: null as unknown as THREE.MOUSE,
    };
    dom_capture_init: {
      this.renderer.domElement.addEventListener(
        'pointerdown',
        (ev) => {
          this.orbit.mouseButtons.LEFT = ev.altKey ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE);
        },
        { capture: true },
      );
    }
    if (initialCam) {
      this.orbit.target.set(...initialCam.target);
    } else {
      this.orbit.target.set(0, 0, 0);
    }
    this.orbit.update();

    this.transform = new TransformControls(this.activeCam, this.renderer.domElement);
    this.transformHelper = this.transform.getHelper();
    this.scene.add(this.transformHelper);
    this.applySnapToTransform();

    this.transform.addEventListener('dragging-changed', (ev) => {
      this.orbit.enabled = !(ev as { value: unknown }).value;
    });
    this.transform.addEventListener('mouseDown', () => {
      this.beforeTransformDoc = deepClone(this.doc);
      if (this.selectedIds.length > 1) {
        this.captureMultiPivotOffsets();
      }
    });
    this.transform.addEventListener('objectChange', () => {
      this.handleTransformObjectChange();
    });
    this.transform.addEventListener('mouseUp', () => {
      if (this.beforeTransformDoc) {
        const label =
          this.transform.mode === 'translate' ? 'Move Objects' :
          this.transform.mode === 'rotate' ? 'Rotate Objects' : 'Scale Objects';
        this.callbacks.onObjectsTransformed(label, this.beforeTransformDoc);
        this.beforeTransformDoc = null;
      }
      this.refreshSelectionBoxes();
    });

    this.scene.add(this.worldGroup);
    this.scene.add(this.lightHandlesGroup);
    this.scene.add(this.selectionGroup);
    this.scene.add(this.multiPivot);

    const gridSpan = Math.max(doc.dimensions.width, doc.dimensions.depth, 60);
    this.gridHelper = new THREE.GridHelper(gridSpan, Math.round(gridSpan), '#475569', '#1e293b');
    this.gridHelper.position.y = 0.015;
    this.scene.add(this.gridHelper);

    const ringGeo = new THREE.RingGeometry(0.92, 1.0, 36);
    ringGeo.rotateX(-Math.PI * 0.5);
    this.brushRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: '#22d3ee', side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.brushRing.visible = false;
    this.scene.add(this.brushRing);

    this.rebuildAll(doc);

    this.onPointerMoveBound = (e) => this.onPointerMove(e);
    this.onPointerDownBound = (e) => this.onPointerDown(e);
    this.onPointerUpBound = (e) => this.onPointerUp(e);
    this.onKeyDownBound = (e) => this.flyKeys.add(e.code);
    this.onKeyUpBound = (e) => this.flyKeys.delete(e.code);
    this.onContextMenuBound = (e) => e.preventDefault();

    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', this.onPointerMoveBound);
    dom.addEventListener('pointerdown', this.onPointerDownBound);
    window.addEventListener('pointerup', this.onPointerUpBound);
    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    dom.addEventListener('contextmenu', this.onContextMenuBound);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);

    this.lastFrameMs = performance.now();
    this.loop(this.lastFrameMs);
  }

  public rebuildAll(doc: CustomMapDocument): void {
    this.doc = doc;
    this.syncLighting();
    this.syncTerrainFull();
    this.syncBoundariesVisual();

    // Clear existing object groups
    for (const grp of this.objectMeshes.values()) {
      this.worldGroup.remove(grp);
    }
    this.objectMeshes.clear();

    for (const obj of doc.objects) {
      this.addOrReplaceObjectMesh(obj);
    }
    this.syncPlacedLights();
    this.attachSelectionGizmo();
  }

  public setDocumentRef(doc: CustomMapDocument): void {
    this.doc = doc;
  }

  public syncLighting(): void {
    if (this.lightingDispose) {
      this.lightingDispose();
      this.lightingDispose = null;
    }
    const maxSpan = Math.max(this.doc.dimensions.width, this.doc.dimensions.depth) * 0.65;
    const handle = applyCustomLightingToScene(this.scene, this.doc.lighting, maxSpan);
    this.lightingDispose = handle.dispose;
    this.syncPlacedLights();
  }

  public syncPlacedLights(): void {
    this.lightHandlesGroup.clear();
    for (const obj of this.doc.objects) {
      if (!obj.visible || obj.category !== 'lighting' || !obj.lightProps) continue;
      const lp = obj.lightProps;
      const col = new THREE.Color(lp.color || '#ffffff');
      if (lp.lightType === 'point' || lp.lightType === 'area') {
        const pl = new THREE.PointLight(col, lp.intensity, lp.range || 24, lp.decay ?? 1.5);
        pl.position.set(...obj.position);
        this.lightHandlesGroup.add(pl);
      } else if (lp.lightType === 'spot') {
        const sl = new THREE.SpotLight(col, lp.intensity, lp.range || 30, THREE.MathUtils.degToRad(Math.max(10, Math.min(85, lp.angleDeg || 42))), lp.penumbra ?? 0.45, lp.decay ?? 1.4);
        sl.position.set(...obj.position);
        const dir = new THREE.Vector3(0, -1, 0).applyEuler(new THREE.Euler(THREE.MathUtils.degToRad(obj.rotation[0]), THREE.MathUtils.degToRad(obj.rotation[1]), THREE.MathUtils.degToRad(obj.rotation[2]), 'YXZ'));
        sl.target.position.copy(sl.position).addScaledVector(dir, 6);
        this.lightHandlesGroup.add(sl, sl.target);
      } else {
        const dl = new THREE.DirectionalLight(col, lp.intensity);
        dl.position.set(...obj.position);
        this.lightHandlesGroup.add(dl);
      }
    }
  }

  public syncTerrainFull(): void {
    if (this.terrainMesh) {
      this.worldGroup.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh = null;
    }
    this.terrainMesh = buildTerrainMesh(this.doc.terrain);
    this.worldGroup.add(this.terrainMesh);
  }

  public syncTerrainVerticesOnly(): void {
    if (!this.terrainMesh) {
      this.syncTerrainFull();
      return;
    }
    this.terrainMesh.visible = this.doc.terrain.enabled;
    syncTerrainGeometry(this.terrainMesh, this.doc.terrain);
  }

  public syncBoundariesVisual(): void {
    if (this.boundaryHelper) {
      this.scene.remove(this.boundaryHelper);
      this.boundaryHelper = null;
    }
    const { minX, maxX, minZ, maxZ, maxY } = this.doc.boundaries;
    const box = new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, maxY, maxZ));
    const helper = new THREE.Box3Helper(box, new THREE.Color('#f43f5e'));
    const g = new THREE.Group();
    g.add(helper);
    g.visible = this.showBoundaries;
    this.scene.add(g);
    this.boundaryHelper = g;
  }

  public addOrReplaceObjectMesh(obj: MapObject): void {
    const old = this.objectMeshes.get(obj.id);
    if (old) {
      this.worldGroup.remove(old);
      old.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).geometry?.dispose();
      });
    }
    const grp = buildAssetMesh(obj, true);
    this.worldGroup.add(grp);
    this.objectMeshes.set(obj.id, grp);
    if (obj.category === 'lighting') this.syncPlacedLights();
    this.refreshSelectionBoxes();
  }

  public removeObjectMesh(id: string): void {
    const grp = this.objectMeshes.get(id);
    if (grp) {
      this.worldGroup.remove(grp);
      grp.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).geometry?.dispose();
      });
      this.objectMeshes.delete(id);
    }
    this.syncPlacedLights();
    this.refreshSelectionBoxes();
  }

  public syncObjectTransformOnly(obj: MapObject): void {
    const grp = this.objectMeshes.get(obj.id);
    if (!grp) return;
    grp.position.set(obj.position[0], obj.position[1], obj.position[2]);
    grp.rotation.set(
      THREE.MathUtils.degToRad(obj.rotation[0]),
      THREE.MathUtils.degToRad(obj.rotation[1]),
      THREE.MathUtils.degToRad(obj.rotation[2]),
    );
    grp.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
    grp.visible = obj.visible;
    if (obj.category === 'lighting') this.syncPlacedLights();
    this.refreshSelectionBoxes();
  }

  public setSelectedIds(ids: string[]): void {
    this.selectedIds = [...ids];
    this.attachSelectionGizmo();
    this.refreshSelectionBoxes();
  }

  private attachSelectionGizmo(): void {
    if (this.toolMode === 'place' || this.toolMode === 'terrain') {
      this.transform.detach();
      return;
    }
    if (this.toolMode === 'translate' || this.toolMode === 'rotate' || this.toolMode === 'scale') {
      this.transform.setMode(this.toolMode);
    }

    const unlocked = this.selectedIds.filter((id) => {
      const o = this.doc.objects.find((x) => x.id === id);
      return o && !o.locked;
    });

    if (unlocked.length === 0) {
      this.transform.detach();
      return;
    }

    if (this.toolMode === 'select') {
      // Allow immediate move gizmo on select just like UE unless hidden
      this.transform.setMode('translate');
    }

    if (unlocked.length === 1) {
      const mesh = this.objectMeshes.get(unlocked[0]);
      if (mesh) this.transform.attach(mesh);
      else this.transform.detach();
    } else {
      const center = new THREE.Vector3();
      let cnt = 0;
      for (const id of unlocked) {
        const m = this.objectMeshes.get(id);
        if (m) {
          center.add(m.position);
          cnt++;
        }
      }
      if (cnt > 0) center.divideScalar(cnt);
      this.multiPivot.position.copy(center);
      this.multiPivot.rotation.set(0, 0, 0);
      this.multiPivot.scale.set(1, 1, 1);
      this.multiPivot.updateMatrixWorld();
      this.transform.attach(this.multiPivot);
    }
  }

  private captureMultiPivotOffsets(): void {
    this.multiPivotStartMatrices.clear();
    const invPivot = this.multiPivot.matrixWorld.clone().invert();
    for (const id of this.selectedIds) {
      const m = this.objectMeshes.get(id);
      if (!m) continue;
      m.updateMatrixWorld();
      const rel = invPivot.clone().multiply(m.matrixWorld);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      rel.decompose(pos, quat, scale);
      this.multiPivotStartMatrices.set(id, { pos, rot: new THREE.Euler().setFromQuaternion(quat), scale });
    }
  }

  private handleTransformObjectChange(): void {
    const unlocked = this.selectedIds.filter((id) => {
      const o = this.doc.objects.find((x) => x.id === id);
      return o && !o.locked;
    });
    if (unlocked.length === 1) {
      const id = unlocked[0];
      const o = this.doc.objects.find((x) => x.id === id);
      const m = this.objectMeshes.get(id);
      if (o && m) {
        o.position = [Number(m.position.x.toFixed(3)), Number(m.position.y.toFixed(3)), Number(m.position.z.toFixed(3))];
        o.rotation = [
          Number(THREE.MathUtils.radToDeg(m.rotation.x).toFixed(2)),
          Number(THREE.MathUtils.radToDeg(m.rotation.y).toFixed(2)),
          Number(THREE.MathUtils.radToDeg(m.rotation.z).toFixed(2)),
        ];
        o.scale = [
          Number(Math.max(0.05, m.scale.x).toFixed(3)),
          Number(Math.max(0.05, m.scale.y).toFixed(3)),
          Number(Math.max(0.05, m.scale.z).toFixed(3)),
        ];
        if (o.category === 'lighting') this.syncPlacedLights();
      }
    } else if (unlocked.length > 1) {
      this.multiPivot.updateMatrixWorld();
      for (const id of unlocked) {
        const start = this.multiPivotStartMatrices.get(id);
        const o = this.doc.objects.find((x) => x.id === id);
        const m = this.objectMeshes.get(id);
        if (!start || !o || !m) continue;
        const localMat = new THREE.Matrix4().compose(start.pos, new THREE.Quaternion().setFromEuler(start.rot), start.scale);
        const worldMat = this.multiPivot.matrixWorld.clone().multiply(localMat);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        worldMat.decompose(pos, quat, scl);
        const eul = new THREE.Euler().setFromQuaternion(quat);
        m.position.copy(pos);
        m.rotation.copy(eul);
        m.scale.copy(scl);
        o.position = [Number(pos.x.toFixed(3)), Number(pos.y.toFixed(3)), Number(pos.z.toFixed(3))];
        o.rotation = [
          Number(THREE.MathUtils.radToDeg(eul.x).toFixed(2)),
          Number(THREE.MathUtils.radToDeg(eul.y).toFixed(2)),
          Number(THREE.MathUtils.radToDeg(eul.z).toFixed(2)),
        ];
        o.scale = [
          Number(Math.max(0.05, scl.x).toFixed(3)),
          Number(Math.max(0.05, scl.y).toFixed(3)),
          Number(Math.max(0.05, scl.z).toFixed(3)),
        ];
      }
    }
    this.refreshSelectionBoxes();
  }

  private refreshSelectionBoxes(): void {
    this.selectionGroup.clear();
    for (const id of this.selectedIds) {
      const m = this.objectMeshes.get(id);
      if (!m || !m.visible) continue;
      const box = new THREE.BoxHelper(m, 0x38bdf8);
      this.selectionGroup.add(box);
    }
  }

  public isFlying(): boolean {
    return this.flyHeld;
  }

  public setToolMode(mode: EditorToolMode): void {
    this.toolMode = mode;
    if (mode !== 'place') this.clearPlacementPreview();
    if (mode !== 'terrain') this.brushRing.visible = false;
    this.attachSelectionGizmo();
  }

  public setSnapConfig(snap: Partial<SnapConfig>): void {
    this.snap = { ...this.snap, ...snap };
    this.applySnapToTransform();
  }

  private applySnapToTransform(): void {
    if (this.snap.enabled) {
      this.transform.setTranslationSnap(this.snap.translateStep);
      this.transform.setRotationSnap(THREE.MathUtils.degToRad(this.snap.rotateStepDeg));
      this.transform.setScaleSnap(this.snap.scaleStep);
    } else {
      this.transform.setTranslationSnap(null);
      this.transform.setRotationSnap(null);
      this.transform.setScaleSnap(null);
    }
  }

  public setTerrainSettings(settings: Partial<TerrainToolSettings>): void {
    this.terrainSettings = { ...this.terrainSettings, ...settings };
  }

  public startPlacement(payload: PlacementPayload): void {
    this.clearPlacementPreview();
    this.placementPayload = payload;
    this.toolMode = 'place';
    this.previewYawDeg = 0;
    this.previewScaleMult = 1;
    this.transform.detach();

    if (payload.kind === 'asset' && payload.assetId) {
      const def = getAssetDefinition(payload.assetId);
      if (!def) return;
      const stub: MapObject = {
        id: '__preview__',
        name: def.name,
        category: def.objectCategory,
        assetId: def.id,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [...def.defaultScale],
        material: def.defaultMaterial,
        collision: { ...def.defaultCollision },
        visible: true,
        locked: false,
        isStatic: true,
        lightProps: def.defaultLight ? { ...def.defaultLight } : undefined,
        gameplayProps: def.defaultGameplay ? { ...def.defaultGameplay } : undefined,
      };
      this.previewGroup = buildAssetMesh(stub, true);
    } else if (payload.kind === 'prefab' && payload.prefab) {
      this.previewGroup = buildPrefabPreviewGroup(payload.prefab, true);
    }

    if (this.previewGroup) {
      this.applyPreviewTint('#22c55e');
      this.scene.add(this.previewGroup);
    }
  }

  public rotatePreview(deltaDeg: number): void {
    this.previewYawDeg = (this.previewYawDeg + deltaDeg) % 360;
    if (this.previewGroup) {
      this.previewGroup.rotation.y = THREE.MathUtils.degToRad(this.previewYawDeg);
    }
  }

  public scalePreview(multDelta: number): void {
    this.previewScaleMult = Math.max(0.25, Math.min(4.0, Number((this.previewScaleMult + multDelta).toFixed(2))));
    if (this.previewGroup) {
      this.previewGroup.scale.setScalar(this.previewScaleMult);
    }
  }

  public clearPlacementPreview(): void {
    this.placementPayload = null;
    if (this.previewGroup) {
      this.scene.remove(this.previewGroup);
      this.previewGroup = null;
    }
  }

  private applyPreviewTint(hex: string): void {
    if (!this.previewGroup) return;
    const tint = new THREE.Color(hex);
    this.previewGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        const orig = m.material as THREE.MeshStandardMaterial;
        const cloned = orig.clone();
        cloned.transparent = true;
        cloned.opacity = 0.52;
        if ('emissive' in cloned && cloned.emissive) {
          cloned.emissive.copy(tint);
          cloned.emissiveIntensity = 0.35;
        } else {
          cloned.color.lerp(tint, 0.5);
        }
        m.material = cloned;
      }
    });
  }

  public toggleViewMode(): 'perspective' | 'topdown' {
    this.viewMode = this.viewMode === 'perspective' ? 'topdown' : 'perspective';
    this.activeCam = this.viewMode === 'topdown' ? this.orthoCam : this.perspCam;
    this.transform.camera = this.activeCam;
    this.orbit.object = this.activeCam;
    this.orbit.enableRotate = this.viewMode === 'perspective';
    if (this.viewMode === 'topdown') {
      this.orthoCam.position.set(this.orbit.target.x, 90, this.orbit.target.z);
      this.orthoCam.lookAt(this.orbit.target.x, 0, this.orbit.target.z);
    }
    this.orbit.update();
    return this.viewMode;
  }

  public focusOnPosition(pos: [number, number, number], radius = 8): void {
    const t = new THREE.Vector3(pos[0], pos[1], pos[2]);
    this.orbit.target.copy(t);
    if (this.viewMode === 'topdown') {
      this.orthoCam.position.set(t.x, 90, t.z);
      this.orthoCam.lookAt(t);
    } else {
      const dir = this.perspCam.position.clone().sub(this.orbit.target);
      if (dir.lengthSq() < 1) dir.set(0, 8, 12);
      dir.normalize().multiplyScalar(Math.max(4, radius * 1.4));
      this.perspCam.position.copy(t).add(dir);
    }
    this.orbit.update();
  }

  public setHelpersVisibility(opts: { grid?: boolean; boundaries?: boolean; navMesh?: boolean; bake?: CustomNavBakeResult | null }): void {
    if (opts.grid !== undefined) {
      this.showGrid = opts.grid;
      this.gridHelper.visible = opts.grid;
    }
    if (opts.boundaries !== undefined) {
      this.showBoundaries = opts.boundaries;
      if (this.boundaryHelper) this.boundaryHelper.visible = opts.boundaries;
    }
    if (opts.bake !== undefined) {
      this.lastBake = opts.bake;
    }
    if (opts.navMesh !== undefined) {
      this.showNavMesh = opts.navMesh;
    }
    if (this.navOverlay) {
      this.scene.remove(this.navOverlay);
      this.navOverlay = null;
    }
    if (this.showNavMesh && this.lastBake) {
      this.navOverlay = buildNavMeshOverlay(this.lastBake, this.doc);
      this.scene.add(this.navOverlay);
    }
  }

  private updateRayFromEvent(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.activeCam);
  }

  private getSurfaceHitPoint(e: PointerEvent): THREE.Vector3 | null {
    this.updateRayFromEvent(e);
    const targets: THREE.Object3D[] = [];
    if (this.terrainMesh && this.terrainMesh.visible) targets.push(this.terrainMesh);
    for (const [id, grp] of this.objectMeshes.entries()) {
      const o = this.doc.objects.find((x) => x.id === id);
      if (o && o.visible && o.category !== 'spawns' && o.category !== 'objectives' && o.category !== 'lighting' && o.category !== 'zones') {
        targets.push(grp);
      }
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length > 0) return hits[0].point.clone();

    const fallback = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundFallbackPlane, fallback)) {
      return fallback;
    }
    return null;
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.flyHeld && this.viewMode === 'perspective') {
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      const offset = this.orbit.target.clone().sub(this.perspCam.position);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= dx * 0.0045;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * 0.0045, 0.08, Math.PI - 0.08);
      offset.setFromSpherical(spherical);
      this.orbit.target.copy(this.perspCam.position).add(offset);
      this.perspCam.lookAt(this.orbit.target);
      return;
    }

    if (this.toolMode === 'place' && this.previewGroup) {
      const hit = this.getSurfaceHitPoint(e);
      if (hit) {
        if (this.snap.enabled) {
          const s = Math.max(0.25, this.snap.translateStep);
          hit.x = Math.round(hit.x / s) * s;
          hit.z = Math.round(hit.z / s) * s;
        }
        this.previewPos.copy(hit);
        this.previewGroup.position.copy(hit);
        const inside =
          hit.x >= this.doc.boundaries.minX &&
          hit.x <= this.doc.boundaries.maxX &&
          hit.z >= this.doc.boundaries.minZ &&
          hit.z <= this.doc.boundaries.maxZ;
        // Validate no identical overlap with existing collider
        const duplicateCenter = this.doc.objects.some(
          (o) =>
            o.visible &&
            o.collision.enabled &&
            Math.hypot(o.position[0] - hit.x, o.position[2] - hit.z) < 0.35 &&
            Math.abs(o.position[1] - hit.y) < 0.35,
        );
        const valid = inside && !duplicateCenter;
        if (valid !== this.previewValid) {
          this.previewValid = valid;
          this.applyPreviewTint(valid ? '#22c55e' : '#ef4444');
        }
        this.callbacks.onStatusUpdate(
          valid
            ? `Place @ (${hit.x.toFixed(1)}, ${hit.y.toFixed(1)}, ${hit.z.toFixed(1)}) — Click to place, Q/E rotate, Esc cancel`
            : `INVALID PLACEMENT (${!inside ? 'Outside map bounds' : 'Overlapping object'})`,
        );
      }
      return;
    }

    if (this.toolMode === 'terrain') {
      const hit = this.getSurfaceHitPoint(e);
      if (hit) {
        this.brushRing.visible = true;
        this.brushRing.position.set(hit.x, hit.y + 0.08, hit.z);
        this.brushRing.scale.setScalar(this.terrainSettings.radius);
        if (this.sculpting) {
          this.applySculptStep(hit);
        }
      } else {
        this.brushRing.visible = false;
      }
    }
  }

  private applySculptStep(hit: THREE.Vector3): void {
    const changed = applyTerrainBrush(this.doc.terrain, {
      mode: this.terrainSettings.mode,
      worldX: hit.x,
      worldZ: hit.z,
      radius: this.terrainSettings.radius,
      strength: this.terrainSettings.strength,
      falloff: this.terrainSettings.falloff,
      smoothness: this.terrainSettings.smoothness,
      targetHeight: this.terrainSettings.targetHeight,
      slopeStart: this.slopeStartPt ?? undefined,
    });
    if (changed) {
      this.syncTerrainVerticesOnly();
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 2) {
      if (this.toolMode === 'place') {
        this.clearPlacementPreview();
        this.callbacks.onPlacementCancelled();
        return;
      }
      this.flyHeld = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.orbit.enabled = false;
      return;
    }

    if (e.button !== 0) return;

    // Ignore click if gizmo is hovered/dragging
    if (this.transform.axis !== null || this.transform.dragging) return;

    if (this.toolMode === 'place' && this.placementPayload) {
      if (!this.previewValid) {
        this.callbacks.onStatusUpdate('Cannot place here: invalid or out-of-bounds location.');
        return;
      }
      const p: [number, number, number] = [
        Number(this.previewPos.x.toFixed(3)),
        Number(this.previewPos.y.toFixed(3)),
        Number(this.previewPos.z.toFixed(3)),
      ];
      const newItems: MapObject[] = [];
      if (this.placementPayload.kind === 'asset' && this.placementPayload.assetId) {
        const def = getAssetDefinition(this.placementPayload.assetId);
        if (def) {
          newItems.push({
            id: createUniqueId('obj'),
            name: def.name,
            category: def.objectCategory,
            assetId: def.id,
            position: p,
            rotation: [0, this.previewYawDeg, 0],
            scale: [
              Number((def.defaultScale[0] * this.previewScaleMult).toFixed(2)),
              Number((def.defaultScale[1] * this.previewScaleMult).toFixed(2)),
              Number((def.defaultScale[2] * this.previewScaleMult).toFixed(2)),
            ],
            material: deepClone(def.defaultMaterial),
            collision: { ...def.defaultCollision },
            visible: true,
            locked: false,
            isStatic: true,
            lightProps: def.defaultLight ? deepClone(def.defaultLight) : undefined,
            gameplayProps: def.defaultGameplay ? deepClone(def.defaultGameplay) : undefined,
          });
        }
      } else if (this.placementPayload.kind === 'prefab' && this.placementPayload.prefab) {
        const rad = THREE.MathUtils.degToRad(this.previewYawDeg);
        const cosY = Math.cos(rad);
        const sinY = Math.sin(rad);
        for (const item of this.placementPayload.prefab.items) {
          const rx = (item.position[0] * cosY - item.position[2] * sinY) * this.previewScaleMult;
          const rz = (item.position[0] * sinY + item.position[2] * cosY) * this.previewScaleMult;
          newItems.push({
            ...deepClone(item),
            id: createUniqueId('obj'),
            prefabId: this.placementPayload.prefab.id,
            position: [
              Number((p[0] + rx).toFixed(3)),
              Number((p[1] + item.position[1] * this.previewScaleMult).toFixed(3)),
              Number((p[2] + rz).toFixed(3)),
            ],
            rotation: [item.rotation[0], (item.rotation[1] + this.previewYawDeg) % 360, item.rotation[2]],
            scale: [
              Number((item.scale[0] * this.previewScaleMult).toFixed(2)),
              Number((item.scale[1] * this.previewScaleMult).toFixed(2)),
              Number((item.scale[2] * this.previewScaleMult).toFixed(2)),
            ],
          });
        }
      }
      if (newItems.length > 0) {
        this.callbacks.onPlaceRequested(newItems);
        if (!e.shiftKey) {
          this.clearPlacementPreview();
          this.callbacks.onPlacementCancelled();
        }
      }
      return;
    }

    if (this.toolMode === 'terrain') {
      const hit = this.getSurfaceHitPoint(e);
      if (hit) {
        this.sculpting = true;
        this.orbit.enabled = false;
        this.sculptBeforeHeights = [...this.doc.terrain.heights];
        this.slopeStartPt = [hit.x, hit.y, hit.z];
        this.applySculptStep(hit);
      }
      return;
    }

    // Object selection via raycast (ignore when Alt+LMB orbiting)
    if (e.altKey) return;
    this.updateRayFromEvent(e);
    const selectableGroups = Array.from(this.objectMeshes.values()).filter((g) => g.visible);
    const hits = this.raycaster.intersectObjects(selectableGroups, true);
    if (hits.length > 0) {
      let cur: THREE.Object3D | null = hits[0].object;
      let hitId: string | undefined;
      while (cur) {
        if (typeof cur.userData?.mapObjectId === 'string') {
          hitId = cur.userData.mapObjectId;
          break;
        }
        cur = cur.parent;
      }
      if (hitId) {
        this.callbacks.onSelectIds([hitId], e.shiftKey);
        return;
      }
    }
    if (!e.shiftKey) {
      this.callbacks.onSelectIds([], false);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button === 2 && this.flyHeld) {
      this.flyHeld = false;
      this.orbit.enabled = true;
    }
    if (this.sculpting) {
      this.sculpting = false;
      this.orbit.enabled = true;
      if (this.sculptBeforeHeights) {
        this.callbacks.onTerrainChanged(this.sculptBeforeHeights, [...this.doc.terrain.heights]);
        this.sculptBeforeHeights = null;
      }
      this.slopeStartPt = null;
    }
  }

  public getCameraState(): EditorCameraState {
    return {
      position: [
        Number(this.perspCam.position.x.toFixed(2)),
        Number(this.perspCam.position.y.toFixed(2)),
        Number(this.perspCam.position.z.toFixed(2)),
      ],
      target: [
        Number(this.orbit.target.x.toFixed(2)),
        Number(this.orbit.target.y.toFixed(2)),
        Number(this.orbit.target.z.toFixed(2)),
      ],
      viewMode: this.viewMode,
    };
  }

  public captureThumbnails(): { previewDataUrl: string; topdownDataUrl: string } {
    const prevHelperVis = this.transformHelper.visible;
    const prevGridVis = this.gridHelper.visible;
    const prevBoundVis = this.boundaryHelper?.visible ?? false;
    const prevSelVis = this.selectionGroup.visible;
    const prevBrushVis = this.brushRing.visible;
    const prevNavVis = this.navOverlay?.visible ?? false;
    const prevCam = this.activeCam;

    this.transformHelper.visible = false;
    this.gridHelper.visible = false;
    if (this.boundaryHelper) this.boundaryHelper.visible = false;
    this.selectionGroup.visible = false;
    this.brushRing.visible = false;
    if (this.navOverlay) this.navOverlay.visible = false;

    // 1. 3D overview capture
    const overviewCam = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 400);
    const span = Math.max(this.doc.dimensions.width, this.doc.dimensions.depth);
    overviewCam.position.set(span * 0.45, Math.max(16, span * 0.36), span * 0.48);
    overviewCam.lookAt(0, 1, 0);

    const w = this.renderer.domElement.width;
    const h = this.renderer.domElement.height;
    this.renderer.setSize(480, 270, false);
    this.renderer.render(this.scene, overviewCam);
    const previewDataUrl = this.renderer.domElement.toDataURL('image/png');

    // 2. Top-down capture
    const topSpan = span * 0.56;
    const topCam = new THREE.OrthographicCamera(-topSpan, topSpan, topSpan, -topSpan, 0.5, 250);
    topCam.position.set(0, 90, 0);
    topCam.up.set(0, 0, -1);
    topCam.lookAt(0, 0, 0);
    this.renderer.setSize(320, 320, false);
    this.renderer.render(this.scene, topCam);
    const topdownDataUrl = this.renderer.domElement.toDataURL('image/png');

    // Restore original size and visibility
    this.renderer.setSize(w / Math.min(window.devicePixelRatio || 1, 2), h / Math.min(window.devicePixelRatio || 1, 2), false);
    this.onResize();
    this.transformHelper.visible = prevHelperVis;
    this.gridHelper.visible = prevGridVis;
    if (this.boundaryHelper) this.boundaryHelper.visible = prevBoundVis;
    this.selectionGroup.visible = prevSelVis;
    this.brushRing.visible = prevBrushVis;
    if (this.navOverlay) this.navOverlay.visible = prevNavVis;
    this.activeCam = prevCam;

    return { previewDataUrl, topdownDataUrl };
  }

  public getPerfStats(): { fps: number; objects: number; triangles: number; drawCalls: number } {
    return {
      fps: Math.round(this.fpsAvg),
      objects: this.doc.objects.length,
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls,
    };
  }

  private stepFreeFly(dt: number): void {
    if (!this.flyHeld || this.viewMode !== 'perspective') return;
    const f = (this.flyKeys.has('KeyW') ? 1 : 0) - (this.flyKeys.has('KeyS') ? 1 : 0);
    const r = (this.flyKeys.has('KeyD') ? 1 : 0) - (this.flyKeys.has('KeyA') ? 1 : 0);
    const u = (this.flyKeys.has('KeyE') ? 1 : 0) - (this.flyKeys.has('KeyQ') ? 1 : 0);
    if (f === 0 && r === 0 && u === 0) return;

    const speed = (this.flyKeys.has('ShiftLeft') || this.flyKeys.has('ShiftRight') ? 36 : 16) * dt;
    const forward = new THREE.Vector3();
    this.perspCam.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3()
      .addScaledVector(forward, f * speed)
      .addScaledVector(right, r * speed);
    move.y += u * speed;
    this.perspCam.position.add(move);
    this.orbit.target.add(move);
  }

  private loop = (nowMs: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, Math.max(0.001, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;
    const instFps = 1 / dt;
    this.fpsAvg = this.fpsAvg * 0.9 + instFps * 0.1;

    this.stepFreeFly(dt);
    if (!this.flyHeld) {
      this.orbit.update();
    }
    this.renderer.render(this.scene, this.activeCam);
  };

  private onResize(): void {
    const w = Math.max(200, this.container.clientWidth || window.innerWidth);
    const h = Math.max(200, this.container.clientHeight || window.innerHeight);
    const aspect = w / h;
    this.perspCam.aspect = aspect;
    this.perspCam.updateProjectionMatrix();

    const orthoHalf = Math.max(this.doc.dimensions.width, this.doc.dimensions.depth) * 0.65;
    this.orthoCam.left = -orthoHalf * aspect;
    this.orthoCam.right = orthoHalf * aspect;
    this.orthoCam.top = orthoHalf;
    this.orthoCam.bottom = -orthoHalf;
    this.orthoCam.updateProjectionMatrix();

    this.renderer.setSize(w, h);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointermove', this.onPointerMoveBound);
    dom.removeEventListener('pointerdown', this.onPointerDownBound);
    window.removeEventListener('pointerup', this.onPointerUpBound);
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    dom.removeEventListener('contextmenu', this.onContextMenuBound);
    this.transform.dispose();
    this.orbit.dispose();
    if (this.lightingDispose) this.lightingDispose();
    this.renderer.dispose();
    if (dom.parentElement) dom.parentElement.removeChild(dom);
  }
}

export { sampleMapSurfaceHeight, extractObjectColliderBoxes };
