// Décor 3D : salle, podium en T (bords LED), backstage (rideaux + arche LED), public,
// accessoires, éclairage (principale + contre-jour rose + faisceaux mobiles).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STEM_HALF, STEM_Z0, STEM_Z1, BAR_Z0, BAR_Z1, BAR_HALF, BACK_Z0, BACK_HALF, PODIUM_H, marks, fixedObstacles } from './config.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, TAU, lerp, clamp } from './utils.js';

export const HALL = { x: 26, zMin: -22, zMax: 34, h: 15 };

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07050c);
    this.scene.fog = new THREE.FogExp2(0x0a0610, 0.014);
    const pm = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.ledMats = [];          // matériaux LED qui pulsent
    this.beams = [];            // spots mobiles
    this.pulsing = [];          // objets qui réagissent au beat
    this.buildHall();
    this.buildPodium();
    this.buildBackstage();
    this.buildLights();
    this.buildProps();
    this.buildAudience();
  }

  // ------------------------------------------------------------------ salle
  buildHall() {
    const S = this.scene;
    const floorTex = canvasTex(512, 512, (x, w, h) => {
      x.fillStyle = '#14101a'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      x.strokeStyle = 'rgba(255,255,255,0.05)'; x.lineWidth = 2; for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, h); x.moveTo(0, i * 64); x.lineTo(w, i * 64); x.stroke(); }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(10, 14);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL.x * 2, HALL.zMax - HALL.zMin), new THREE.MeshPhysicalMaterial({ map: floorTex, color: 0x6a6070, roughness: 0.62, metalness: 0.0, clearcoat: 0.0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, (HALL.zMax + HALL.zMin) / 2); floor.receiveShadow = true;
    S.add(floor);
    // murs sombres + bandes LED
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0d0a14, roughness: 0.9 });
    const mkWall = (w, h, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat); m.position.set(x, y, z); m.rotation.y = ry; S.add(m); return m; };
    mkWall(HALL.zMax - HALL.zMin, HALL.h, -HALL.x, HALL.h / 2, (HALL.zMax + HALL.zMin) / 2, Math.PI / 2);
    mkWall(HALL.zMax - HALL.zMin, HALL.h, HALL.x, HALL.h / 2, (HALL.zMax + HALL.zMin) / 2, -Math.PI / 2);
    mkWall(HALL.x * 2, HALL.h, 0, HALL.h / 2, HALL.zMax, Math.PI);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALL.x * 2, HALL.zMax - HALL.zMin), new THREE.MeshStandardMaterial({ color: 0x050308, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, HALL.h, (HALL.zMax + HALL.zMin) / 2); S.add(ceil);
    // fermes de scène (truss) au plafond
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x2a2630, metalness: 0.8, roughness: 0.4 });
    for (const z of [-8, 0, 8, 16]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(HALL.x * 1.6, 0.18, 0.18), trussMat); t.position.set(0, 9.2, z); S.add(t);
    }
    for (const x of [-9, -3, 3, 9]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 40), trussMat); t.position.set(x, 9.2, 4); S.add(t); }
    // bandes LED murales
    this.wallLed = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2d95, emissiveIntensity: 2.0 });
    this.ledMats.push({ mat: this.wallLed, base: 0.8, amp: 1.0 });
    for (const sx of [-1, 1]) for (const y of [1.5, 5.5]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, HALL.zMax - HALL.zMin - 2), this.wallLed);
      b.position.set(sx * (HALL.x - 0.1), y, (HALL.zMax + HALL.zMin) / 2); S.add(b);
    }
  }

  // ----------------------------------------------------------------- podium
  buildPodium() {
    const S = this.scene;
    const outline = [
      [-BACK_HALF, BACK_Z0], [BACK_HALF, BACK_Z0], [BACK_HALF, STEM_Z0], [STEM_HALF, STEM_Z0], [STEM_HALF, STEM_Z1],
      [BAR_HALF, BAR_Z0], [BAR_HALF, BAR_Z1], [-BAR_HALF, BAR_Z1], [-BAR_HALF, BAR_Z0], [-STEM_HALF, STEM_Z1],
      [-STEM_HALF, STEM_Z0], [-BACK_HALF, STEM_Z0],
    ];
    this.outline = outline;
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: PODIUM_H, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    // UV monde (pour une texture régulière sur le dessus)
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 3, pos.getZ(i) / 3);
    const topTex = canvasTex(512, 512, (x, w, h) => {
      x.fillStyle = '#0b0a10'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 6000; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.045})`; x.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
      x.strokeStyle = 'rgba(255,255,255,0.07)'; x.lineWidth = 1.5; x.strokeRect(0, 0, w, h);
    });
    topTex.wrapS = topTex.wrapT = THREE.RepeatWrapping;
    const topMat = new THREE.MeshPhysicalMaterial({ map: topTex, color: 0xffffff, roughness: 0.42, metalness: 0.0, clearcoat: 0.2, clearcoatRoughness: 0.45, envMapIntensity: 0.8, reflectivity: 0.4, specularIntensity: 0.5 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x0b0910, roughness: 0.9, metalness: 0.0 });
    const podium = new THREE.Mesh(geo, [topMat, sideMat]);
    // ExtrudeGeometry : groupe 0 = faces (dessus/dessous), groupe 1 = côtés
    podium.receiveShadow = true; podium.castShadow = false;
    S.add(podium);
    this.podium = podium;

    // bandeaux LED lumineux le long du bord (haut et bas du podium)
    this.edgeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3fa0, emissiveIntensity: 3 });
    this.edgeMat2 = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x42d9ff, emissiveIntensity: 2 });
    this.ledMats.push({ mat: this.edgeMat, base: 1.1, amp: 2.0, hue: true }, { mat: this.edgeMat2, base: 0.8, amp: 1.2 });
    const n = outline.length;
    for (let i = 0; i < n; i++) {
      const [x0, z0] = outline[i], [x1, z1] = outline[(i + 1) % n];
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      // normale vers l'intérieur pour décaler légèrement
      const nx = -(z1 - z0) / len, nz = (x1 - x0) / len; // gauche du sens de parcours
      const addStrip = (y, mat, h) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, len), mat);
        b.position.set(mx, y, mz); b.rotation.y = ang; S.add(b);
      };
      addStrip(PODIUM_H + 0.015, this.edgeMat, 0.03);
      addStrip(0.06, this.edgeMat2, 0.06);
      // pour être sûr d'être dehors : bande légèrement poussée vers l'extérieur (vérifiée par rotation)
    }
    // marques de pose : anneaux lumineux sur le podium
    this.markRings = marks.map((m) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 48), new THREE.MeshBasicMaterial({ color: 0xffd36e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(m.pos.x, PODIUM_H + 0.012, m.pos.z);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.4, 40), new THREE.MeshBasicMaterial({ color: 0xff7ac8, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
      dot.rotation.x = -Math.PI / 2; dot.position.set(m.pos.x, PODIUM_H + 0.011, m.pos.z);
      S.add(ring, dot); return ring;
    });
    // ligne axiale en pointillés lumineux
  }

  // --------------------------------------------------------------- backstage
  buildBackstage() {
    const S = this.scene;
    // rideaux de velours : plan plissé
    const curtainGeo = (w, h, folds) => {
      const g = new THREE.PlaneGeometry(w, h, 160, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * folds) * 0.28 + Math.sin(p.getX(i) * folds * 2.3 + 1) * 0.07);
      g.computeVertexNormals(); return g;
    };
    const velvet = new THREE.MeshPhysicalMaterial({ color: 0x4a0b25, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0xff4f9a), sheenRoughness: 0.5, side: THREE.DoubleSide });
    const c1 = new THREE.Mesh(curtainGeo(26, 12, 2.6), velvet); c1.position.set(0, 6, BACK_Z0 - 0.8); c1.castShadow = true; c1.receiveShadow = true; S.add(c1);
    // rideaux latéraux (dans les coulisses)
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(curtainGeo(5.2, 9, 3), velvet); c.rotation.y = -s * Math.PI / 2; c.position.set(s * (BACK_HALF + 0.3), 4.6, (BACK_Z0 + STEM_Z0) / 2); S.add(c);
      const front = new THREE.Mesh(curtainGeo(5, 9, 3), velvet); front.position.set(s * 6.6, 5.4, STEM_Z0 - 0.6); S.add(front);
    }
    // panneau LED derrière l'arche (dégradé animé)
    this.ledScreenTex = canvasTex(256, 256, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ff3d9a'); g.addColorStop(0.5, '#7a2cff'); g.addColorStop(1, '#14c8ff');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.globalAlpha = 0.22; x.fillStyle = '#000'; for (let i = 0; i < h; i += 6) x.fillRect(0, i, w, 2);
    });
    this.ledScreenMat = new THREE.MeshBasicMaterial({ map: this.ledScreenTex, transparent: true, opacity: 0.85, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 6.6), this.ledScreenMat); screen.position.set(0, PODIUM_H + 3.4, STEM_Z0 - 0.7); S.add(screen);
    this.ledScreen = screen;
    // arche LED : deux montants + demi-cercle (tube lumineux), couleur cyclique
    const R = 2.55, yb = PODIUM_H + 3.0, z = STEM_Z0 - 0.5;
    const pts = [];
    for (let i = 0; i <= 14; i++) pts.push(new THREE.Vector3(-R, PODIUM_H + (yb - PODIUM_H) * (i / 14), z));
    for (let i = 1; i <= 40; i++) { const a = Math.PI - (i / 40) * Math.PI; pts.push(new THREE.Vector3(Math.cos(a) * R, yb + Math.sin(a) * R, z)); }
    for (let i = 1; i <= 14; i++) pts.push(new THREE.Vector3(R, yb - (yb - PODIUM_H) * (i / 14), z));
    const archGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.09, 10, false);
    this.archMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2d95, emissiveIntensity: 4 });
    this.ledMats.push({ mat: this.archMat, base: 2, amp: 3, hue: true });
    S.add(new THREE.Mesh(archGeo, this.archMat));
    const archGeo2 = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x * 1.1, (p.y - PODIUM_H) * 1.06 + PODIUM_H, p.z + 0.12))), 160, 0.05, 8, false);
    this.archMat2 = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x44d9ff, emissiveIntensity: 3 });
    this.ledMats.push({ mat: this.archMat2, base: 1.5, amp: 2 });
    S.add(new THREE.Mesh(archGeo2, this.archMat2));
    // fines barres verticales LED (rideau lumineux)
    const barMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 2.4 });
    this.ledMats.push({ mat: barMat, base: 1.1, amp: 1 });
    for (let i = -4; i <= 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 6.2, 0.05), barMat); b.position.set(i * 0.55, PODIUM_H + 3.1, STEM_Z0 - 0.35); S.add(b); }
  }

  // ------------------------------------------------------------- éclairage
  buildLights() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0x6a5a9a, 0x1a0f20, 0.35));
    // lumière principale avec ombres (de face, en hauteur)
    const key = new THREE.DirectionalLight(0xfff0e0, 2.4);
    key.position.set(5, 14, 22); key.target.position.set(0, 0, -1);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 60;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 3;
    S.add(key, key.target); this.key = key;
    // contre-jour rose (depuis le backstage) + contre-jour cyan
    const rim = new THREE.DirectionalLight(0xff3f94, 2.4); rim.position.set(-4, 7, -22); rim.target.position.set(0, 1, 2); S.add(rim, rim.target);
    const rim2 = new THREE.DirectionalLight(0x3fd8ff, 1.4); rim2.position.set(6, 6, -20); rim2.target.position.set(0, 1, 2); S.add(rim2, rim2.target);
    this.rim = rim; this.rim2 = rim2;
    // faisceaux de projecteurs mobiles (spots + cônes volumétriques)
    const colors = [0xffffff, 0xff5fb0, 0x6fd4ff, 0xffd37a, 0xb98cff, 0xffffff];
    for (let i = 0; i < 6; i++) {
      const spot = new THREE.SpotLight(colors[i], 90, 40, 0.13, 0.7, 1.4);
      const side = i % 2 ? 1 : -1;
      spot.position.set(side * (3 + (i >> 1) * 4.5), 9, -4 + (i >> 1) * 7);
      S.add(spot, spot.target);
      const beam = this.makeBeam(colors[i], 9.6, 0.14);
      beam.position.copy(spot.position); S.add(beam);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 14), new THREE.MeshStandardMaterial({ color: 0x15131a, metalness: 0.9, roughness: 0.3, emissive: colors[i], emissiveIntensity: 0.6 }));
      lamp.position.copy(spot.position); S.add(lamp);
      this.beams.push({ spot, beam, lamp, phase: i * 1.1, side, color: new THREE.Color(colors[i]) });
    }
    // pool de lumières pour les flashs des photographes
    this.flashLights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xfff4e8, 0, 14, 1.6); S.add(l); this.flashLights.push({ light: l, t0: -10, power: 0 }); }
  }

  makeBeam(color, length, radius) {
    const geo = new THREE.CylinderGeometry(radius * 0.2, radius * 2.6, length, 28, 1, true);
    geo.translate(0, -length / 2, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0.16 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vH = position.y; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV; varying float vH;
        void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float fall = smoothstep(-${length.toFixed(1)}, 0.0, vH) ; gl_FragColor = vec4(color, f*opacity*(0.25+fall*0.9)); }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = 5;
    return m;
  }

  // -------------------------------------------------------------- accessoires
  buildProps() {
    const S = this.scene;
    const vaseMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f0ea, roughness: 0.15, clearcoat: 1, metalness: 0.0 });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x2f7a3d, roughness: 0.7 });
    const petals = [0xff4d8d, 0xffffff, 0xffb347, 0xc084fc, 0xff6b6b].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, emissive: c, emissiveIntensity: 0.08 }));
    const vaseGeo = new THREE.LatheGeometry([[0.001, 0], [0.16, 0], [0.2, 0.1], [0.14, 0.35], [0.1, 0.5], [0.15, 0.6], [0.001, 0.6]].map(([r, y]) => new THREE.Vector2(r, y)), 28);
    const stand = new THREE.MeshStandardMaterial({ color: 0x1a1a20, metalness: 0.85, roughness: 0.35 });
    this.props = [];
    const rnd = mulberry32(7);
    for (const o of fixedObstacles) {
      const g = new THREE.Group(); g.position.set(o.pos.x, PODIUM_H, o.pos.z);
      if (o.type === 'vase') {
        const v = new THREE.Mesh(vaseGeo, vaseMat); v.castShadow = true; g.add(v);
        for (let i = 0; i < 17; i++) {
          const a = rnd() * TAU, r = rnd() * 0.12, h = 0.85 + rnd() * 0.45;
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, h - 0.4, 5), stemMat);
          stem.position.set(Math.cos(a) * r * 0.5, 0.4 + (h - 0.4) / 2, Math.sin(a) * r * 0.5); stem.rotation.set(Math.sin(a) * r * 1.5, 0, -Math.cos(a) * r * 1.5); g.add(stem);
          const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06 + rnd() * 0.04, 1), petals[(rnd() * petals.length) | 0]);
          fl.position.set(Math.cos(a) * r * 1.6, h + 0.05, Math.sin(a) * r * 1.6); fl.scale.y = 0.75; fl.castShadow = true; g.add(fl);
        }
        const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), stemMat); leaves.position.y = 0.72; leaves.scale.set(1, 0.5, 1); g.add(leaves);
      } else {
        // projecteur sur pied : trépied + lampe orientable
        for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 1.0, 6), stand); leg.position.set(Math.cos(a) * 0.14, 0.5, Math.sin(a) * 0.14); leg.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2); leg.castShadow = true; g.add(leg); }
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 8), stand); mast.position.y = 1.0; mast.castShadow = true; g.add(mast);
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.38, 18), new THREE.MeshStandardMaterial({ color: 0x15131a, metalness: 0.9, roughness: 0.3 }));
        head.position.y = 1.85; head.rotation.x = Math.PI / 2 - 0.4; head.castShadow = true; g.add(head);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), new THREE.MeshBasicMaterial({ color: 0xfff1cc, toneMapped: false }));
        lens.position.set(0, 0.2, 0.0); lens.rotation.x = 0; head.add(lens); lens.rotation.x = -Math.PI / 2; lens.position.set(0, 0.19, 0);
        const cone = this.makeBeam(0xfff1d0, 6, 0.1); cone.position.set(0, 1.85, 0); cone.rotation.x = -0.4; cone.rotation.y = 0; g.add(cone);
        cone.rotation.set(Math.PI - 0.55, 0, 0); cone.position.set(0, 1.85, 0.0);
        cone.scale.set(0.8, 0.8, 0.8); cone.material.uniforms.opacity.value = 0.07;
      }
      S.add(g); this.props.push(g);
    }
  }

  // ----------------------------------------------------------------- public
  buildAudience() {
    const S = this.scene;
    const rnd = mulberry32(2026);
    const seats = [];
    // 4 rangs face à la barre du T
    for (let row = 0; row < 4; row++) {
      const z = BAR_Z1 + 1.5 + row * 1.05, y = 0.28 + row * 0.3;
      for (let x = -8.4; x <= 8.4; x += 0.66) seats.push({ x: x + (rnd() - 0.5) * 0.08, y, z, yaw: Math.PI, row, kind: 'front' });
    }
    // 3 rangs de chaque côté du couloir
    for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
      const x = side * (STEM_HALF + 1.1 + row * 1.0), y = 0.28 + row * 0.3;
      for (let z = -10.4; z <= 6.4; z += 0.68) seats.push({ x, y, z: z + (rnd() - 0.5) * 0.08, yaw: -side * Math.PI / 2, row, kind: 'side' });
    }
    this.seats = seats;
    // paliers
    const tierMat = new THREE.MeshStandardMaterial({ color: 0x120e19, roughness: 0.8 });
    for (let row = 0; row < 4; row++) { const t = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.28 + row * 0.3, 0.98), tierMat); t.position.set(0, (0.28 + row * 0.3) / 2, BAR_Z1 + 1.5 + row * 1.05 + 0.1); t.receiveShadow = true; S.add(t); }
    for (const side of [-1, 1]) for (let row = 0; row < 3; row++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.28 + row * 0.3, 18.4), tierMat); t.position.set(side * (STEM_HALF + 1.1 + row * 1.0) + side * 0.05, (0.28 + row * 0.3) / 2, -2.2); t.receiveShadow = true; S.add(t); }

    const N = seats.length;
    const bodyGeo = new THREE.CapsuleGeometry(0.17, 0.36, 4, 10); bodyGeo.translate(0, 0.46, 0);
    const headGeo = new THREE.SphereGeometry(0.105, 14, 12); headGeo.translate(0, 0.98, 0);
    const hairGeo = new THREE.SphereGeometry(0.113, 14, 10, 0, TAU, 0, 2.0); hairGeo.translate(0, 0.995, -0.005);
    const seat = new THREE.BoxGeometry(0.46, 0.07, 0.42); seat.translate(0, 0.4, 0.0);
    const back = new THREE.BoxGeometry(0.46, 0.46, 0.05); back.translate(0, 0.62, -0.2);
    const base = new THREE.BoxGeometry(0.1, 0.4, 0.1); base.translate(0, 0.2, 0);
    const chairGeo = mergeGeometries([seat, back, base]);
    const mk = (g, mat) => { const m = new THREE.InstancedMesh(g, mat, N); m.castShadow = true; m.receiveShadow = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); S.add(m); return m; };
    const bodyMat = new THREE.MeshPhysicalMaterial({ roughness: 0.6, sheen: 0.4 });
    this.iBody = mk(bodyGeo, bodyMat); this.iHead = mk(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }));
    this.iHair = mk(hairGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 })); this.iChair = mk(chairGeo, new THREE.MeshStandardMaterial({ color: 0x1d1727, roughness: 0.7 }));
    this.iChair.castShadow = false;
    const outfit = [0x1d1d27, 0x2c2c3a, 0x5b1d3a, 0x1d3a5b, 0xe8e0d6, 0x0f0f14, 0x7a2f4f, 0x3a3a46, 0xb08a5a, 0x14463c];
    const skins = [0xf2c9b0, 0xe0ac86, 0xc68a62, 0x8d5a3c, 0x5e3a26, 0xf6d5c0];
    const hairs = [0x16100c, 0x2a1a12, 0x6b4426, 0xd2b070, 0x0c0c0c, 0x4a2a20, 0x8a8a8a];
    const col = new THREE.Color();
    this.vips = [];
    seats.forEach((s, i) => {
      const vip = (s.kind === 'front' && s.row < 2 && rnd() < 0.09) || (s.kind === 'side' && s.row < 1 && rnd() < 0.07);
      s.vip = vip; s.phase = rnd() * TAU; s.excite = 0.5 + rnd() * 0.8;
      col.set(vip ? 0xf2b630 : outfit[(rnd() * outfit.length) | 0]); this.iBody.setColorAt(i, col);
      col.set(skins[(rnd() * skins.length) | 0]); this.iHead.setColorAt(i, col);
      col.set(hairs[(rnd() * hairs.length) | 0]); this.iHair.setColorAt(i, col);
      s.phone = rnd() < 0.45;
      if (vip) this.vips.push(s);
    });
    this.iBody.instanceColor.needsUpdate = this.iHead.instanceColor.needsUpdate = this.iHair.instanceColor.needsUpdate = true;
    this.chairDummy = new THREE.Object3D();
    seats.forEach((s, i) => { const d = this.chairDummy; d.position.set(s.x, s.y, s.z + (s.kind === 'front' ? 0.16 : 0)); d.rotation.set(0, s.yaw, 0); d.scale.set(1, 1, 1); d.position.x += s.kind === 'side' ? -Math.sign(s.x) * 0.16 : 0; d.updateMatrix(); this.iChair.setMatrixAt(i, d.matrix); });
    // étoiles dorées au-dessus des VIP
    const star = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.07 : 0.17, a = (i / 10) * TAU + Math.PI / 2; i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r); } star.closePath();
    const starGeo = new THREE.ExtrudeGeometry(star, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
    const starMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffa800, emissiveIntensity: 1.6, metalness: 0.8, roughness: 0.25 });
    this.stars = this.vips.map((s) => { const m = new THREE.Mesh(starGeo, starMat); m.position.set(s.x, s.y + 1.45, s.z); S.add(m); return m; });
    // téléphones lumineux
    this.phones = seats.map((s, i) => s.phone ? i : -1).filter((i) => i >= 0);
    const phoneGeo = new THREE.BoxGeometry(0.075, 0.14, 0.01);
    this.iPhone = new THREE.InstancedMesh(phoneGeo, new THREE.MeshBasicMaterial({ color: 0xbfe8ff, toneMapped: false }), this.phones.length);
    this.iPhone.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.iPhone.frustumCulled = false; S.add(this.iPhone);
    // flashs du public (étincelles blanches)
    const fp = new Float32Array(60 * 3);
    this.crowdFlashGeo = new THREE.BufferGeometry(); this.crowdFlashGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    this.crowdFlashPts = new THREE.Points(this.crowdFlashGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, map: this.glowTexture() }));
    this.crowdFlashPts.frustumCulled = false; S.add(this.crowdFlashPts);
    this.crowdFlashTimes = new Float32Array(60).fill(-10);
    this.crowdFlashCursor = 0;
    this.audDummy = new THREE.Object3D();
  }

  glowTexture() {
    if (this._glow) return this._glow;
    this._glow = canvasTex(64, 64, (x, w, h) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); });
    return this._glow;
  }

  // --------------------------------------------------------------- animation
  // beat : 0..1 (impulsion), t : temps (s), score : 0..10, bpm
  update(dt, t, beat, score, bpm) {
    const intensity = clamp(score / 10, 0, 1);
    // LED
    const hue = (t * 0.03) % 1;
    for (const l of this.ledMats) {
      l.mat.emissiveIntensity = l.base + l.amp * beat * (0.4 + 0.6 * intensity);
      if (l.hue) l.mat.emissive.setHSL((0.88 + 0.12 * Math.sin(t * 0.3) + hue * 0.0) % 1, 0.9, 0.55);
    }
    this.ledScreenMat.opacity = 0.65 + 0.3 * beat;
    this.ledScreenTex.offset.y = (t * 0.03) % 1; this.ledScreenTex.wrapT = THREE.RepeatWrapping;
    // anneaux de pose
    this.markRings.forEach((r, i) => { r.material.opacity = 0.55 + 0.4 * Math.sin(t * 3 + i) * 0.5 + 0.3 * beat; r.scale.setScalar(1 + 0.06 * beat); });
    // faisceaux mobiles
    this.beams.forEach((b, i) => {
      const a = t * (0.35 + 0.05 * i) + b.phase;
      const tx = Math.sin(a) * 4.5 + (i % 3 - 1) * 1.5, tz = 1 + Math.cos(a * 0.8 + i) * 9.5;
      b.spot.target.position.set(tx, PODIUM_H, tz);
      b.spot.intensity = 50 + 110 * beat * (0.4 + 0.6 * intensity) + 40 * intensity;
      // orienter le cône volumétrique vers la cible
      const dir = new THREE.Vector3().subVectors(b.spot.target.position, b.spot.position).normalize();
      b.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      b.beam.material.uniforms.opacity.value = 0.07 + 0.09 * beat * (0.4 + 0.6 * intensity);
      b.lamp.lookAt(b.spot.target.position); b.lamp.rotateX(Math.PI / 2);
      b.spot.color.copy(b.color).offsetHSL(0.08 * Math.sin(t * 0.2 + i), 0, 0);
      b.beam.material.uniforms.color.value.copy(b.spot.color);
    });
    this.rim.intensity = 1.4 + 1.2 * beat * (0.4 + 0.6 * intensity);
    this.rim2.intensity = 0.7 + 0.9 * (1 - beat) * intensity;
    // étoiles VIP
    this.stars.forEach((m, i) => { m.rotation.y = t * 1.4 + i; m.position.y = this.vips[i].y + 1.43 + Math.sin(t * 2 + i) * 0.04; });
    // public : balancement sur le rythme, plus d'énergie quand la note monte
    const D = this.audDummy, beatHz = bpm / 60;
    const amp = 0.012 + 0.05 * intensity;
    const bob = Math.abs(Math.sin(t * Math.PI * beatHz)) ;
    let pi = 0;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      const lean = Math.sin(t * Math.PI * beatHz * 0.5 + s.phase) * (0.04 + 0.1 * intensity) * s.excite;
      const up = (s.vip ? 1.3 : 1) * bob * amp * s.excite + (beat * 0.03 * intensity);
      D.position.set(s.x, s.y + up, s.z); D.rotation.set(0, s.yaw, lean); D.scale.set(1, 1, 1);
      if (s.kind === 'front') D.position.z += 0.16; else D.position.x += -Math.sign(s.x) * 0.16;
      D.updateMatrix();
      this.iBody.setMatrixAt(i, D.matrix); this.iHead.setMatrixAt(i, D.matrix); this.iHair.setMatrixAt(i, D.matrix);
      if (s.phone) {
        const raised = 0.5 + 0.5 * Math.sin(t * 0.6 + s.phase * 3) > 0.35 ? 1 : 0;
        const q = new THREE.Object3D();
        const fx = Math.sin(s.yaw) * -0.0, fz = 0;
        const fwd = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
        q.position.set(s.x + fwd.x * 0.28, s.y + up + (raised ? 0.9 : 0.1), s.z + fwd.z * 0.28 + (s.kind === 'front' ? 0.16 : 0));
        q.rotation.set(-0.2, s.yaw, 0); q.scale.setScalar(raised ? 1 : 0.0001);
        q.updateMatrix(); this.iPhone.setMatrixAt(pi++, q.matrix);
      }
    }
    this.iBody.instanceMatrix.needsUpdate = this.iHead.instanceMatrix.needsUpdate = this.iHair.instanceMatrix.needsUpdate = true;
    this.iPhone.instanceMatrix.needsUpdate = true;
    // flashs du public
    if (Math.random() < dt * (3 + 22 * intensity)) this.crowdFlash(t);
    const ph = this.crowdFlashGeo.attributes.position.array;
    let any = 0;
    for (let i = 0; i < 60; i++) { const age = t - this.crowdFlashTimes[i]; if (age > 0.12) ph[i * 3 + 1] = -100; else any = 1; }
    this.crowdFlashGeo.attributes.position.needsUpdate = true;
    this.crowdFlashPts.material.opacity = any ? 1 : 0;
    // lumières de flash
    for (const f of this.flashLights) { const age = t - f.t0; f.light.intensity = age < 0.35 ? f.power * Math.exp(-age * 14) : 0; }
  }

  crowdFlash(t) {
    const s = this.seats[(Math.random() * this.seats.length) | 0];
    const i = this.crowdFlashCursor++ % 60;
    const a = this.crowdFlashGeo.attributes.position.array;
    a[i * 3] = s.x + (Math.random() - 0.5) * 0.2; a[i * 3 + 1] = s.y + 1.1; a[i * 3 + 2] = s.z;
    this.crowdFlashTimes[i] = t;
  }

  fireFlashLight(pos, t, power = 90) {
    // réutilise la lumière la plus ancienne
    this.flashLights.sort((a, b) => a.t0 - b.t0);
    const f = this.flashLights[0]; f.t0 = t; f.power = power; f.light.position.copy(pos); f.light.position.y = PODIUM_H + 1.5;
  }
}
