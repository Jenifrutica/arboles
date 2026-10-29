import * as THREE from "three";
import gsap from "gsap";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import type { Dataset, LCAResult } from "./types";
import type { Layout, Point } from "./layout";

interface RankStyle {
  color: number;
  size: number;
}

/** Colour and radius per rank: the visual grammar of the tree. */
export const RANK_STYLE: Record<string, RankStyle> = {
  "acellular root": { color: 0xb08cf2, size: 0.62 },
  "cellular root": { color: 0xe9e3d6, size: 0.66 },
  "domain": { color: 0xf2c879, size: 0.8 },
  "superkingdom": { color: 0xf2c879, size: 0.74 },
  "kingdom": { color: 0x6fd3c7, size: 0.62 },
  "subkingdom": { color: 0x6fd3c7, size: 0.52 },
  "realm": { color: 0xb08cf2, size: 0.56 },
  "phylum": { color: 0xa48cf2, size: 0.5 },
  "subphylum": { color: 0xa48cf2, size: 0.44 },
  "superclass": { color: 0xe88aa8, size: 0.46 },
  "class": { color: 0xe88aa8, size: 0.42 },
  "subclass": { color: 0xe88aa8, size: 0.38 },
  "infraclass": { color: 0xe88aa8, size: 0.34 },
  "superorder": { color: 0x9bd37f, size: 0.36 },
  "order": { color: 0x9bd37f, size: 0.34 },
  "suborder": { color: 0x9bd37f, size: 0.3 },
  "infraorder": { color: 0x9bd37f, size: 0.28 },
  "parvorder": { color: 0x9bd37f, size: 0.26 },
  "superfamily": { color: 0x8fa6c9, size: 0.28 },
  "family": { color: 0x8fa6c9, size: 0.26 },
  "subfamily": { color: 0x8fa6c9, size: 0.23 },
  "tribe": { color: 0x8fa6c9, size: 0.21 },
  "subtribe": { color: 0x8fa6c9, size: 0.2 },
  "genus": { color: 0xe3a17a, size: 0.21 },
  "subgenus": { color: 0xe3a17a, size: 0.19 },
  "species": { color: 0xede6d6, size: 0.19 },
  "subspecies": { color: 0xede6d6, size: 0.17 },
  "clade": { color: 0xd8b96f, size: 0.38 },
  "species group": { color: 0xc9b393, size: 0.22 },
  "species subgroup": { color: 0xc9b393, size: 0.2 },
  "no rank": { color: 0x9aa3ae, size: 0.24 },
};

const FALLBACK: RankStyle = { color: 0x9aa3ae, size: 0.24 };
const NODE_SCALE = 0.42;
const COLOR_A = new THREE.Color(0xe8b25c);
const COLOR_B = new THREE.Color(0x6fd3c7);
const COLOR_LCA = new THREE.Color(0xf7e6b8);

export function rankStyle(rank: string): RankStyle {
  return RANK_STYLE[rank] ?? FALLBACK;
}

export interface HeroSpec {
  taxid: number;
  url: string;
  scale?: number;
  /** Vertical offset from the node, so the piece never covers its label. */
  offsetY?: number;
  /** Radial separation from the branch, in world units. */
  push?: number;
}

export class TreeScene {
  private readonly host: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly targetOffsetX = window.innerWidth > 1100 ? -2.4 : 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  private nodes?: THREE.InstancedMesh;
  private halos?: THREE.InstancedMesh;
  private edges?: THREE.LineSegments;
  private readonly stars: THREE.Points;

  private order: number[] = [];
  private readonly colorOverrides = new Map<number, THREE.Color>();
  private positions = new Map<number, Point>();
  private dataset?: Dataset;
  private heroes: Array<{
    taxid: number;
    object: THREE.Object3D;
    baseY: number;
    phase: number;
    offsetY: number;
    push: number;
  }> = [];
  private cometA?: THREE.Mesh;
  private cometB?: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private pathMeshes: THREE.Mesh[] = [];
  private labels: CSS2DObject[] = [];
  private clock = new THREE.Clock();

  onPick: (taxid: number) => void = () => {};
  onHover: (taxid: number | null, clientX: number, clientY: number) => void = () => {};

  constructor(host: HTMLElement) {
    this.host = host;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x05070b, 1);
    host.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(host.clientWidth, host.clientHeight);
    this.labelRenderer.domElement.className = "labels";
    host.appendChild(this.labelRenderer.domElement);

    this.scene.background = new THREE.Color(0x05070b);
    this.scene.fog = new THREE.FogExp2(0x05070b, 0.0062);

    this.camera = new THREE.PerspectiveCamera(48, host.clientWidth / host.clientHeight, 0.1, 600);
    this.camera.position.set(0, 12, 30);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 140;
    this.controls.target.set(this.targetOffsetX, 0, 0);

    // Lighting: warm key, cool fill, soft ambient. Keeps the ceramic models readable.
    const hemisphere = new THREE.HemisphereLight(0xbfd4ff, 0x171018, 1.05);
    const key = new THREE.DirectionalLight(0xfff1dc, 2.1);
    key.position.set(18, 26, 14);
    const rim = new THREE.DirectionalLight(0x6fd3c7, 0.9);
    rim.position.set(-20, -8, -16);
    const core = new THREE.PointLight(0xf2c879, 60, 60, 2);
    core.position.set(0, 0, 0);
    this.scene.add(hemisphere, key, rim, core);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.stars = this.buildStars();
    this.scene.add(this.stars);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(host.clientWidth, host.clientHeight),
      0.38,
      0.55,
      0.9,
    );
    this.composer.addPass(bloom);

    window.addEventListener("resize", this.onResize);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("dblclick", this.onDoubleClick);

    this.animate();
  }

  // ------------------------------------------------------------- construction

  private buildStars(): THREE.Points {
    const count = 2200;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = 70 + Math.random() * 190;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.cos(phi) * 0.6;
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x7e8ea3,
      size: 0.42,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geometry, material);
  }

  setDataset(dataset: Dataset): void {
    // Rebuilding after an edit must not leak GPU buffers.
    if (this.nodes) {
      this.scene.remove(this.nodes);
      this.nodes.geometry.dispose();
      (this.nodes.material as THREE.Material).dispose();
      this.nodes = undefined;
    }
    if (this.halos) {
      this.scene.remove(this.halos);
      this.halos.geometry.dispose();
      (this.halos.material as THREE.Material).dispose();
      this.halos = undefined;
    }
    this.dataset = dataset;
    const capacity = dataset.byId.size;

    const nodeGeometry = new THREE.IcosahedronGeometry(1, 2);
    const nodeMaterial = new THREE.MeshStandardMaterial({
      metalness: 0.35,
      roughness: 0.42,
      emissive: 0xffffff,
      emissiveIntensity: 0.06,
    });
    this.nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, capacity);
    this.nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nodes.count = 0;

    const haloGeometry = new THREE.IcosahedronGeometry(1, 1);
    const haloMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.halos = new THREE.InstancedMesh(haloGeometry, haloMaterial, capacity);
    this.halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halos.count = 0;

    this.scene.add(this.nodes, this.halos);

    this.cometA = this.buildComet(COLOR_A);
    this.cometB = this.buildComet(COLOR_B);
    this.scene.add(this.cometA, this.cometB);
  }

  private buildComet(color: THREE.Color): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.24, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    return mesh;
  }

  // ------------------------------------------------------------------ layout

  setLayout(layout: Layout): void {
    if (!this.nodes || !this.halos || !this.dataset) {
      return;
    }
    this.order = layout.visible;
    this.positions = layout.positions;

    const matrix = new THREE.Matrix4();
    const haloTarget = new THREE.Matrix4();
    const color = new THREE.Color();
    const origin = new THREE.Vector3();
    const scaleVector = new THREE.Vector3();
    const haloScale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    for (let index = 0; index < this.order.length; index += 1) {
      const taxid = this.order[index];
      const point = layout.positions.get(taxid);
      const node = this.dataset.byId.get(taxid);
      if (!point || !node) {
        continue;
      }
      const style = rankStyle(node.rank);
      const scale = style.size * NODE_SCALE;
      origin.set(point.x, point.y, point.z);

      scaleVector.setScalar(scale);
      matrix.compose(origin, quaternion, scaleVector);
      this.nodes.setMatrixAt(index, matrix);

      haloScale.setScalar(scale * 1.9);
      haloTarget.compose(origin, quaternion, haloScale);
      this.halos.setMatrixAt(index, haloTarget);

      const override = this.colorOverrides.get(taxid);
      color.setHex(override ? override.getHex() : style.color);
      this.nodes.setColorAt(index, color);
      this.halos.setColorAt(index, color);
    }

    this.nodes.count = this.order.length;
    this.halos.count = this.order.length;
    this.nodes.instanceMatrix.needsUpdate = true;
    this.halos.instanceMatrix.needsUpdate = true;
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true;
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;

    this.rebuildEdges(layout);
    this.updateLabels(layout);
    this.updateHeroes();
  }

  private rebuildEdges(layout: Layout): void {
    if (this.edges) {
      this.scene.remove(this.edges);
      this.edges.geometry.dispose();
      (this.edges.material as THREE.Material).dispose();
    }
    const positions = new Float32Array(layout.edges.length * 6);
    const colors = new Float32Array(layout.edges.length * 6);
    const color = new THREE.Color();

    layout.edges.forEach(([parent, child], index) => {
      const from = layout.positions.get(parent);
      const to = layout.positions.get(child);
      if (!from || !to) {
        return;
      }
      positions.set([from.x, from.y, from.z, to.x, to.y, to.z], index * 6);
      const node = this.dataset?.byId.get(child);
      const style = node ? rankStyle(node.rank) : FALLBACK;
      color.setHex(style.color).multiplyScalar(0.5);
      colors.set([color.r, color.g, color.b, color.r, color.g, color.b], index * 6);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.edges = new THREE.LineSegments(geometry, material);
    this.scene.add(this.edges);
  }

  private updateLabels(layout: Layout): void {
    for (const label of this.labels) {
      this.scene.remove(label);
    }
    this.labels = [];
    this.labelRenderer.domElement.replaceChildren();
    let budget = 26;
    for (const taxid of layout.visible) {
      const node = this.dataset?.byId.get(taxid);
      const point = layout.positions.get(taxid);
      if (!node || !point || budget <= 0) {
        continue;
      }
      // Only the skeleton gets a floating label: the root, the two super-roots
      // and the domains. Anything deeper would collide with its neighbours.
      const labelled = new Set(["domain", "cellular root", "acellular root"]);
      if (node.depth !== 0 && !(node.depth <= 2 && labelled.has(node.rank))) {
        continue;
      }
      const element = document.createElement("div");
      element.className = "node-label";
      element.textContent = node.name;
      const label = new CSS2DObject(element);
      label.position.set(point.x, point.y + 0.75, point.z);
      this.scene.add(label);
      this.labels.push(label);
      budget -= 1;
    }
  }

  // --------------------------------------------------------------- colouring

  clearHighlights(): void {
    this.colorOverrides.clear();
    this.clearPaths();
    this.refreshColors();
  }

  /** Draw the two lineages as glowing threads that meet at the ancestor. */
  showPaths(pathA: number[], pathB: number[]): void {
    this.clearPaths();
    const threads: Array<[number[], THREE.Color]> = [
      [pathA, COLOR_A],
      [pathB, COLOR_B],
    ];
    for (const [path, color] of threads) {
      const points: THREE.Vector3[] = [];
      for (const id of path) {
        const point = this.positionOf(id);
        if (point) points.push(point.clone());
      }
      if (points.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.TubeGeometry(curve, Math.max(24, points.length * 4), 0.045, 6, false);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const tube = new THREE.Mesh(geometry, material);
      this.scene.add(tube);
      this.pathMeshes.push(tube);
      gsap.fromTo(material, { opacity: 0 }, { opacity: 0.85, duration: 0.6, ease: "power2.out" });
    }
  }

  private clearPaths(): void {
    for (const mesh of this.pathMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.pathMeshes = [];
  }

  private refreshColors(): void {
    if (!this.nodes || !this.dataset) return;
    const color = new THREE.Color();
    for (let index = 0; index < this.order.length; index += 1) {
      const taxid = this.order[index];
      const node = this.dataset.byId.get(taxid);
      if (!node) continue;
      const override = this.colorOverrides.get(taxid);
      color.setHex(override ? override.getHex() : rankStyle(node.rank).color);
      this.nodes.setColorAt(index, color);
      this.halos?.setColorAt(index, color);
    }
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true;
    if (this.halos?.instanceColor) this.halos.instanceColor.needsUpdate = true;
  }

  highlightPath(ids: number[], color: THREE.Color, intensity = 1): void {
    for (const id of ids) {
      this.colorOverrides.set(id, color.clone().multiplyScalar(intensity));
    }
    this.refreshColors();
  }

  // ------------------------------------------------------------- interaction

  /** Screen coordinates of a node, used by the smoke tests and by tooltips. */
  screenPosition(taxid: number): { x: number; y: number } | null {
    const point = this.positions.get(taxid);
    if (!point) return null;
    const projected = new THREE.Vector3(point.x, point.y, point.z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  private positionOf(taxid: number): THREE.Vector3 | undefined {
    const point = this.positions.get(taxid);
    return point ? new THREE.Vector3(point.x, point.y, point.z) : undefined;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const picked = this.pick(event);
    if (picked !== null) {
      this.onPick(picked);
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const picked = this.pick(event);
    this.onHover(picked, event.clientX, event.clientY);
    this.renderer.domElement.style.cursor = picked !== null ? "pointer" : "grab";
  };

  private onDoubleClick = (): void => {
    this.resetView();
  };

  private pick(event: PointerEvent): number | null {
    if (!this.nodes) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.nodes, false);
    if (hits.length === 0 || hits[0].instanceId === undefined) return null;
    return this.order[hits[0].instanceId] ?? null;
  }

  // -------------------------------------------------------------- animation

  private ping(position: THREE.Vector3, color: THREE.Color, size = 3.2): void {
    const geometry = new THREE.RingGeometry(0.55, 0.62, 48);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.position.copy(position);
    ring.lookAt(this.camera.position);
    this.scene.add(ring);
    this.rings.push(ring);

    gsap.to(ring.scale, { x: size, y: size, z: size, duration: 0.9, ease: "power2.out" });
    gsap.to(material, {
      opacity: 0,
      duration: 0.9,
      ease: "power2.out",
      onComplete: () => {
        this.scene.remove(ring);
        geometry.dispose();
        material.dispose();
        this.rings = this.rings.filter((item) => item !== ring);
      },
    });
  }

  flyTo(taxid: number, distance = 14): void {
    const target = this.positionOf(taxid);
    if (!target) return;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const destination = target.clone().add(direction.multiplyScalar(distance));
    gsap.to(this.camera.position, {
      x: destination.x,
      y: destination.y + 2.2,
      z: destination.z,
      duration: 1.15,
      ease: "power3.inOut",
      onUpdate: () => this.controls.update(),
    });
    gsap.to(this.controls.target, {
      x: target.x,
      y: target.y,
      z: target.z,
      duration: 1.15,
      ease: "power3.inOut",
    });
  }

  resetView(): void {
    gsap.to(this.camera.position, { x: 0, y: 12, z: 30, duration: 1.2, ease: "power3.inOut" });
    gsap.to(this.controls.target, { x: this.targetOffsetX, y: 0, z: 0, duration: 1.2, ease: "power3.inOut" });
  }

  /**
   * Animate the climb described by the backend trace.
   *
   * Each entry of the trace is a real ancestor jump: the comet travels from the
   * source node to the target, and the destination lights up. In ``naive`` mode
   * every jump is a single edge, so the animation reads as a slow crawl; in
   * ``binary`` mode the powers of two produce visible teleports. Same result,
   * hugely different cost — that contrast is the point of the demo.
   */
  async playClimb(result: LCAResult, speed = 1): Promise<void> {
    this.clearHighlights();
    const lca = result.lca.id;
    this.highlightPath(result.path_a, COLOR_A, 1.15);
    this.highlightPath(result.path_b, COLOR_B, 1.15);
    this.colorOverrides.set(lca, COLOR_LCA.clone());
    this.refreshColors();
    this.showPaths(result.path_a, result.path_b);

    const comets = new Map<string, THREE.Mesh | undefined>([
      ["a", this.cometA],
      ["b", this.cometB],
    ]);

    const groups = new Map<number, typeof result.trace>();
    for (const jump of result.trace) {
      const bucket = groups.get(jump.cumulative);
      if (bucket) bucket.push(jump);
      else groups.set(jump.cumulative, [jump]);
    }

    const timeline = gsap.timeline({ paused: false });
    const orderedGroups = [...groups.entries()].sort((left, right) => left[0] - right[0]);
    let cursor = 0;

    for (const [, jumps] of orderedGroups) {
      let groupDuration = 0;
      for (const jump of jumps) {
        const from = this.positionOf(jump.source);
        const to = this.positionOf(jump.target);
        const comet = comets.get(jump.side);
        if (!from || !to || !comet) continue;

        const duration = 0.16 + Math.min(3, jump.power) * 0.14;
        const material = comet.material as THREE.MeshBasicMaterial;

        timeline.set(comet.position, { x: from.x, y: from.y, z: from.z }, cursor);
        timeline.set(comet, { visible: true }, cursor);
        timeline.set(material, { opacity: 0 }, cursor);
        timeline.to(
          comet.position,
          { x: to.x, y: to.y, z: to.z, duration, ease: "power2.inOut" },
          cursor,
        );
        timeline.to(material, { opacity: 1, duration: duration * 0.4 }, cursor);
        timeline.to(material, { opacity: 0, duration: duration * 0.4 }, cursor + duration * 0.6);
        timeline.call(
          () => {
            this.colorOverrides.set(jump.target, jump.side === "a" ? COLOR_A : COLOR_B);
            this.refreshColors();
            this.ping(to, jump.side === "a" ? COLOR_A : COLOR_B, 1.1 + jump.power * 0.4);
          },
          undefined,
          cursor + duration,
        );
        timeline.set(comet, { visible: false }, cursor + duration);
        groupDuration = Math.max(groupDuration, duration);
      }
      cursor += groupDuration + 0.05;
    }

    const lcaPosition = this.positionOf(lca);
    if (lcaPosition) {
      timeline.call(
        () => {
          this.ping(lcaPosition, COLOR_LCA, 4.6);
          this.flyTo(lca, 13);
        },
        undefined,
        cursor,
      );
      cursor += 0.2;
    }

    await new Promise<void>((resolve) => {
      timeline.eventCallback("onComplete", () => resolve());
      timeline.timeScale(speed);
    });
  }

  // ------------------------------------------------------------------ heroes

  async loadHeroes(specs: HeroSpec[]): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(
      specs.map(async (spec) => {
        try {
          const gltf = await loader.loadAsync(spec.url);
          const object = gltf.scene;
          const box = new THREE.Box3().setFromObject(object);
          const size = new THREE.Vector3();
          box.getSize(size);
          const longest = Math.max(size.x, size.y, size.z) || 1;
          const scale = (spec.scale ?? 3.1) / longest;
          object.scale.setScalar(scale);
          const center = new THREE.Vector3();
          box.getCenter(center);
          object.position.sub(center.multiplyScalar(scale));
          object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = false;
              child.receiveShadow = false;
            }
          });
          const wrapper = new THREE.Group();
          wrapper.add(object);
          this.scene.add(wrapper);
          this.heroes.push({
            taxid: spec.taxid,
            object: wrapper,
            baseY: 0,
            phase: Math.random() * Math.PI * 2,
            offsetY: spec.offsetY ?? 1.7,
            push: spec.push ?? 1.6,
          });
        } catch (error) {
          console.warn(`no se pudo cargar ${spec.url}`, error);
        }
      }),
    );
    this.updateHeroes();
  }

  private updateHeroes(): void {
    for (const hero of this.heroes) {
      const point = this.positions.get(hero.taxid);
      if (!point) {
        hero.object.visible = false;
        continue;
      }
      // Push the model outwards along the branch direction so it never sits on
      // top of the node or its neighbours.
      const radius = Math.hypot(point.x, point.z);
      const outward = radius > 0.001 ? { x: point.x / radius, z: point.z / radius } : { x: 0, z: 0 };
      hero.object.visible = true;
      hero.baseY = point.y + hero.offsetY;
      hero.object.position.set(point.x + outward.x * hero.push, hero.baseY, point.z + outward.z * hero.push);
    }
  }

  // -------------------------------------------------------------------- loop

  private onResize = (): void => {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  };

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const elapsed = this.clock.getElapsedTime();
    const delta = this.clock.getDelta();

    for (const hero of this.heroes) {
      if (!hero.object.visible) continue;
      hero.object.position.y = hero.baseY + Math.sin(elapsed * 0.9 + hero.phase) * 0.11;
      hero.object.rotation.y += delta * 0.22;
    }

    this.stars.rotation.y = elapsed * 0.004;
    this.controls.update();
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  };

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
