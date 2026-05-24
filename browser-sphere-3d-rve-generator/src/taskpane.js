import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const state = {
  sceneReady: false,
  meshData: null,
  stlText: "",
  objText: "",
  nodesCsv: "",
  edgesCsv: "",
  facesCsv: ""
};

const $ = (id) => document.getElementById(id);
const DEFAULT_TARGET_CV = { uniform: 0.15, random: 0.6, clustered: 0.85 };

let scene;
let camera;
let renderer;
let controls;
let poreGroup;
let boxGroup;

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function numberValue(id, fallback) {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function textValue(id, fallback) {
  return $(id).value || fallback;
}

function colorValue(id, fallback) {
  const value = textValue(id, fallback).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dsvNumber(value) {
  return Number(value).toFixed(6).replace(/\.?0+$/, "");
}

function randomNormal(rng) {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function pointDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function estimateSpacing(width, height, depth, count) {
  return Math.cbrt((width * height * depth) / Math.max(count, 1));
}

function generateBasePoints(mode, count, width, height, depth, rng, targetCv, margin) {
  if (count <= 0) return [];
  const points = [];
  const jitterScale = clamp(targetCv, 0.05, 1.5);

  if (mode === "uniform") {
    const nx = Math.max(1, Math.ceil(Math.cbrt((count * width * width) / Math.max(height * depth, 1e-9))));
    const ny = Math.max(1, Math.ceil(Math.sqrt(count / nx)));
    const nz = Math.max(1, Math.ceil(count / (nx * ny)));
    const stepX = width / nx;
    const stepY = height / ny;
    const stepZ = depth / nz;
    const cells = [];
    for (let ix = 0; ix < nx; ix += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let iz = 0; iz < nz; iz += 1) {
          cells.push([ix, iy, iz]);
        }
      }
    }
    cells.sort(() => rng() - 0.5);
    for (let i = 0; i < Math.min(count, cells.length); i += 1) {
      const [ix, iy, iz] = cells[i];
      const jitter = 0.28 * jitterScale;
      const x = (ix + 0.5 + (rng() - 0.5) * jitter) * stepX;
      const y = (iy + 0.5 + (rng() - 0.5) * jitter) * stepY;
      const z = (iz + 0.5 + (rng() - 0.5) * jitter) * stepZ;
      points.push([
        clamp(x, margin, width - margin),
        clamp(y, margin, height - margin),
        clamp(z, margin, depth - margin)
      ]);
    }
    return points;
  }

  if (mode === "clustered") {
    const clusterCount = Math.max(2, Math.round(Math.cbrt(count)));
    const centers = generateBasePoints("random", clusterCount, width, height, depth, rng, targetCv, margin);
    const spread = estimateSpacing(width, height, depth, count) * clamp(1.25 - targetCv * 0.55, 0.25, 1.2);
    for (let i = 0; i < count; i += 1) {
      const c = centers[i % centers.length];
      points.push([
        clamp(c[0] + randomNormal(rng) * spread, margin, width - margin),
        clamp(c[1] + randomNormal(rng) * spread, margin, height - margin),
        clamp(c[2] + randomNormal(rng) * spread, margin, depth - margin)
      ]);
    }
    return points;
  }

  for (let i = 0; i < count; i += 1) {
    points.push([
      margin + rng() * Math.max(width - 2 * margin, 1e-9),
      margin + rng() * Math.max(height - 2 * margin, 1e-9),
      margin + rng() * Math.max(depth - 2 * margin, 1e-9)
    ]);
  }
  return points;
}

function generateSeedPoints(mode, count, width, height, depth, rng, targetCv, clusterCountInput, poresPerClusterInput, clusterCv) {
  const requestedClusteredCount = Math.min(count, Math.max(0, clusterCountInput) * Math.max(0, poresPerClusterInput));
  const primaryCount = Math.max(0, count - requestedClusteredCount);
  const margin = Math.min(width, height, depth) * 0.03;
  const primary = generateBasePoints(mode, primaryCount, width, height, depth, rng, targetCv, margin);
  const clusterCount = Math.min(Math.max(0, clusterCountInput), count);
  const poresPerCluster = clusterCount > 0 ? Math.min(Math.max(0, poresPerClusterInput), count) : 0;
  const clusterCenters = generateBasePoints(mode, clusterCount, width, height, depth, rng, targetCv, margin);
  const clustered = [];
  const spacing = estimateSpacing(width, height, depth, count);
  const spread = spacing * clamp(1.3 - clusterCv * 0.65, 0.18, 1.35);

  for (const center of clusterCenters) {
    for (let i = 0; i < poresPerCluster && primary.length + clustered.length < count; i += 1) {
      clustered.push([
        clamp(center[0] + randomNormal(rng) * spread, margin, width - margin),
        clamp(center[1] + randomNormal(rng) * spread, margin, height - margin),
        clamp(center[2] + randomNormal(rng) * spread, margin, depth - margin)
      ]);
    }
  }

  return {
    points: primary.concat(clustered).slice(0, count),
    primaryCount: primary.length,
    clusterCount,
    poresPerCluster,
    clusteredCount: clustered.length,
    requestedClusteredCount,
    overflowCount: Math.max(0, requestedClusteredCount - clustered.length)
  };
}

function nearestNeighborStats(points) {
  if (points.length < 2) return { mean: 0, cv: 0 };
  const distances = points.map((point, index) => {
    let best = Infinity;
    for (let j = 0; j < points.length; j += 1) {
      if (j === index) continue;
      best = Math.min(best, pointDistance(point, points[j]));
    }
    return best;
  });
  const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const variance = distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / distances.length;
  return { mean, cv: mean > 0 ? Math.sqrt(variance) / mean : 0 };
}

function createDirectionMesh(resolution) {
  const res = clamp(Math.round(resolution), 5, 32);
  const slices = res * 2;
  const dirs = [[0, 0, 1]];
  for (let r = 1; r < res; r += 1) {
    const theta = Math.PI * r / res;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let s = 0; s < slices; s += 1) {
      const phi = 2 * Math.PI * s / slices;
      dirs.push([st * Math.cos(phi), st * Math.sin(phi), ct]);
    }
  }
  const bottomIndex = dirs.length;
  dirs.push([0, 0, -1]);

  const faces = [];
  const ringIndex = (r, s) => 1 + (r - 1) * slices + ((s + slices) % slices);
  for (let s = 0; s < slices; s += 1) {
    faces.push([0, ringIndex(1, s), ringIndex(1, s + 1)]);
  }
  for (let r = 1; r < res - 1; r += 1) {
    for (let s = 0; s < slices; s += 1) {
      const a = ringIndex(r, s);
      const b = ringIndex(r, s + 1);
      const c = ringIndex(r + 1, s + 1);
      const d = ringIndex(r + 1, s);
      faces.push([a, d, c], [a, c, b]);
    }
  }
  for (let s = 0; s < slices; s += 1) {
    faces.push([ringIndex(res - 1, s), bottomIndex, ringIndex(res - 1, s + 1)]);
  }
  return { dirs, faces };
}

function limitByPlane(center, dir, normal, offset, currentLimit) {
  const denom = normal[0] * dir[0] + normal[1] * dir[1] + normal[2] * dir[2];
  if (denom <= 1e-12) return currentLimit;
  const numerator = offset - (normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2]);
  return Math.min(currentLimit, Math.max(0, numerator / denom));
}

function clippedPointAlongDirection(center, dir, points, index, width, height, depth, radius, wallThickness) {
  const margin = wallThickness / 2;
  let limit = radius;
  limit = limitByPlane(center, dir, [-1, 0, 0], -margin, limit);
  limit = limitByPlane(center, dir, [1, 0, 0], width - margin, limit);
  limit = limitByPlane(center, dir, [0, -1, 0], -margin, limit);
  limit = limitByPlane(center, dir, [0, 1, 0], height - margin, limit);
  limit = limitByPlane(center, dir, [0, 0, -1], -margin, limit);
  limit = limitByPlane(center, dir, [0, 0, 1], depth - margin, limit);

  for (let j = 0; j < points.length; j += 1) {
    if (j === index) continue;
    const other = points[j];
    const dx = other[0] - center[0];
    const dy = other[1] - center[1];
    const dz = other[2] - center[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= 1e-9) continue;
    const available = Math.max(0, (distance - wallThickness) / 2);
    if (available >= radius) continue;
    const normal = [dx / distance, dy / distance, dz / distance];
    const offset = normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2] + available;
    limit = limitByPlane(center, dir, normal, offset, limit);
  }

  return [
    center[0] + dir[0] * limit,
    center[1] + dir[1] * limit,
    center[2] + dir[2] * limit
  ];
}

function triangleArea(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

function buildPoreSurfaceMesh(points, width, height, depth, radius, wallThickness, resolution) {
  const directionMesh = createDirectionMesh(resolution);
  const pores = [];
  let clippedCount = 0;

  for (let i = 0; i < points.length; i += 1) {
    const center = points[i];
    const vertices = directionMesh.dirs.map((dir) =>
      clippedPointAlongDirection(center, dir, points, i, width, height, depth, radius, wallThickness)
    );
    const triangles = [];
    let clipped = false;
    for (let v = 0; v < vertices.length; v += 1) {
      if (Math.abs(pointDistance(center, vertices[v]) - radius) > radius * 0.015) {
        clipped = true;
        break;
      }
    }
    for (const face of directionMesh.faces) {
      const a = vertices[face[0]];
      const b = vertices[face[1]];
      const c = vertices[face[2]];
      if (triangleArea(a, b, c) > 1e-10) {
        triangles.push(face);
      }
    }
    if (triangles.length > 0) {
      pores.push({ id: i + 1, center, vertices, triangles });
      if (clipped) clippedCount += 1;
    }
  }

  return { pores, clippedCount };
}

function buildGlobalMesh(width, height, depth, poreMesh) {
  const tolerance = 1e-6;
  const nodeMap = new Map();
  const nodes = [];
  const edges = [];
  const edgeMap = new Map();
  const faces = [];

  function nodeKey(point) {
    return `${Math.round(point[0] / tolerance)}:${Math.round(point[1] / tolerance)}:${Math.round(point[2] / tolerance)}`;
  }

  function addNode(point) {
    const key = nodeKey(point);
    if (nodeMap.has(key)) return nodeMap.get(key);
    const id = nodes.length + 1;
    nodeMap.set(key, id);
    nodes.push({ id, x: point[0], y: point[1], z: point[2] });
    return id;
  }

  function boundarySides(node) {
    const sides = [];
    if (Math.abs(node.x) <= tolerance) sides.push("x0");
    if (Math.abs(node.x - width) <= tolerance) sides.push("x1");
    if (Math.abs(node.y) <= tolerance) sides.push("y0");
    if (Math.abs(node.y - height) <= tolerance) sides.push("y1");
    if (Math.abs(node.z) <= tolerance) sides.push("z0");
    if (Math.abs(node.z - depth) <= tolerance) sides.push("z1");
    return sides;
  }

  function commonBoundarySides(nodeIds) {
    if (nodeIds.length === 0) return [];
    let common = boundarySides(nodes[nodeIds[0] - 1]);
    for (let i = 1; i < nodeIds.length; i += 1) {
      const sides = boundarySides(nodes[nodeIds[i] - 1]);
      common = common.filter((side) => sides.includes(side));
    }
    return common;
  }

  function addEdge(nodeA, nodeB, disconnect) {
    if (nodeA === nodeB) return;
    const key = nodeA < nodeB ? `${nodeA}:${nodeB}` : `${nodeB}:${nodeA}`;
    if (edgeMap.has(key)) {
      const edge = edgeMap.get(key);
      if (disconnect) {
        edge.disconnect = true;
      }
      return;
    }
    const edge = { id: edges.length + 1, node1: nodeA, node2: nodeB, disconnect };
    edgeMap.set(key, edge);
    edges.push(edge);
  }

  for (const pore of poreMesh.pores) {
    const localToGlobal = pore.vertices.map(addNode);
    for (const tri of pore.triangles) {
      const ids = [localToGlobal[tri[0]], localToGlobal[tri[1]], localToGlobal[tri[2]]];
      faces.push({ id: faces.length + 1, nodeIds: ids, poreId: pore.id, region: "AIR_PORE_SURFACE" });
      const isPoreRveContactFace = commonBoundarySides(ids).length > 0;
      addEdge(ids[0], ids[1], isPoreRveContactFace);
      addEdge(ids[1], ids[2], isPoreRveContactFace);
      addEdge(ids[2], ids[0], isPoreRveContactFace);
    }
  }

  const disconnectedBoundaryEdgeCount = edges.filter((edge) => edge.disconnect).length;
  return {
    nodes,
    edges: edges.map((edge) => edge.disconnect ? { id: edge.id, node1: "", node2: "" } : edge),
    faces,
    disconnectedBoundaryEdgeCount,
    connectedEdgeCount: edges.length - disconnectedBoundaryEdgeCount
  };
}

function normalForTriangle(a, b, c) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function buildExports(meshData) {
  const nodesCsv = [
    "Node_ID,X_Coordinate,Y_Coordinate,Z_Coordinate",
    ...meshData.nodes.map((node) => `${node.id},${dsvNumber(node.x)},${dsvNumber(node.y)},${dsvNumber(node.z)}`)
  ].join("\r\n") + "\r\n";
  const edgesCsv = [
    "Edge_ID,Node1_ID,Node2_ID",
    ...meshData.edges.map((edge) => `${edge.id},${edge.node1},${edge.node2}`)
  ].join("\r\n") + "\r\n";
  const facesCsv = [
    "Face_ID,Node1_ID,Node2_ID,Node3_ID,Pore_ID,Region_Type",
    ...meshData.faces.map((face) => `${face.id},${face.nodeIds.join(",")},${face.poreId},${face.region}`)
  ].join("\r\n") + "\r\n";

  const objLines = ["# Sphere 3D RVE pore surface mesh"];
  meshData.nodes.forEach((node) => objLines.push(`v ${dsvNumber(node.x)} ${dsvNumber(node.y)} ${dsvNumber(node.z)}`));
  meshData.faces.forEach((face) => objLines.push(`f ${face.nodeIds.join(" ")}`));

  const stlLines = ["solid sphere_3d_rve"];
  meshData.faces.forEach((face) => {
    const a = meshData.nodes[face.nodeIds[0] - 1];
    const b = meshData.nodes[face.nodeIds[1] - 1];
    const c = meshData.nodes[face.nodeIds[2] - 1];
    const normal = normalForTriangle(a, b, c);
    stlLines.push(`  facet normal ${dsvNumber(normal[0])} ${dsvNumber(normal[1])} ${dsvNumber(normal[2])}`);
    stlLines.push("    outer loop");
    stlLines.push(`      vertex ${dsvNumber(a.x)} ${dsvNumber(a.y)} ${dsvNumber(a.z)}`);
    stlLines.push(`      vertex ${dsvNumber(b.x)} ${dsvNumber(b.y)} ${dsvNumber(b.z)}`);
    stlLines.push(`      vertex ${dsvNumber(c.x)} ${dsvNumber(c.y)} ${dsvNumber(c.z)}`);
    stlLines.push("    endloop");
    stlLines.push("  endfacet");
  });
  stlLines.push("endsolid sphere_3d_rve");

  return {
    nodesCsv,
    edgesCsv,
    facesCsv,
    objText: objLines.join("\n") + "\n",
    stlText: stlLines.join("\n") + "\n"
  };
}

function initScene() {
  if (state.sceneReady) return;
  const viewer = $("viewer");
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, viewer.clientWidth / viewer.clientHeight, 0.1, 10000);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
  viewer.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  poreGroup = new THREE.Group();
  boxGroup = new THREE.Group();
  scene.add(poreGroup, boxGroup);
  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const light = new THREE.DirectionalLight(0xffffff, 1.1);
  light.position.set(70, 90, 120);
  scene.add(light);
  window.addEventListener("resize", resizeScene);
  state.sceneReady = true;
  animate();
}

function resizeScene() {
  if (!renderer) return;
  const viewer = $("viewer");
  camera.aspect = viewer.clientWidth / viewer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function updateScene(width, height, depth, meshData, colors) {
  initScene();
  scene.background = new THREE.Color(colors.bg);
  poreGroup.clear();
  boxGroup.clear();

  const cx = width / 2;
  const cy = height / 2;
  const cz = depth / 2;
  const positions = [];
  meshData.faces.forEach((face) => {
    face.nodeIds.forEach((id) => {
      const node = meshData.nodes[id - 1];
      positions.push(node.x - cx, node.y - cy, node.z - cz);
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const meshMaterial = new THREE.MeshStandardMaterial({
    color: colors.pore,
    transparent: true,
    opacity: colors.poreOpacity,
    side: THREE.DoubleSide,
    roughness: 0.62,
    metalness: 0.02
  });
  const mesh = new THREE.Mesh(geometry, meshMaterial);
  poreGroup.add(mesh);
  if (colors.wireThickness > 0) {
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: colors.wire,
        transparent: true,
        opacity: 0.65,
        linewidth: colors.wireThickness
      })
    );
    poreGroup.add(wire);
  }

  const box = new THREE.BoxGeometry(width, height, depth);
  const boxFill = new THREE.Mesh(
    box,
    new THREE.MeshBasicMaterial({
      color: colors.rveFill,
      transparent: true,
      opacity: 0.14,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
  boxGroup.add(boxFill);
  const edges = new THREE.EdgesGeometry(box);
  const boxWire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: colors.box, linewidth: 1 }));
  boxGroup.add(boxWire);

  const maxDim = Math.max(width, height, depth);
  camera.position.set(maxDim * 1.25, -maxDim * 1.45, maxDim * 1.05);
  controls.target.set(0, 0, 0);
  controls.update();
}

function outputBaseName() {
  const metrics = state.meshData?.metrics;
  if (!metrics) return "sphere_3d_rve";
  const wall = dsvNumber(metrics.wallThickness).replace(".", "p");
  const diameter = dsvNumber(metrics.poreDiameter).replace(".", "p");
  return `sphere_3d_rve_${dsvNumber(metrics.width)}x${dsvNumber(metrics.height)}x${dsvNumber(metrics.depth)}um_${metrics.cellCount}pores_d${diameter}_wall${wall}_seed${metrics.seed}`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function generateRve() {
  const width = Math.max(1, numberValue("width", 40));
  const height = Math.max(1, numberValue("height", 40));
  const depth = Math.max(1, numberValue("depth", 40));
  const cellCount = clamp(Math.round(numberValue("cellCount", 80)), 4, 600);
  const poreDiameter = Math.max(0.1, numberValue("poreDiameter", 10));
  const wallThickness = Math.max(0, numberValue("wallThickness", 1));
  const uniformity = textValue("uniformity", "random");
  const targetCv = clamp(numberValue("targetCv", DEFAULT_TARGET_CV[uniformity] || 0.6), 0.05, 1.5);
  const clusterCount = clamp(Math.round(numberValue("clusterCount", 4)), 0, 80);
  const poresPerCluster = clamp(Math.round(numberValue("poresPerCluster", 8)), 0, cellCount);
  const clusterCv = clamp(numberValue("clusterCv", 0.85), 0.05, 1.5);
  const resolution = clamp(Math.round(numberValue("surfaceResolution", 12)), 5, 32);
  const seed = Math.round(numberValue("seed", 42));
  const colors = {
    bg: colorValue("bgColor", "#f7f8fb"),
    box: colorValue("boxColor", "#263238"),
    rveFill: colorValue("rveFillColor", "#d8e3e6"),
    pore: colorValue("poreColor", "#2aa198"),
    wire: colorValue("wireColor", "#0e4f55"),
    wireThickness: clamp(numberValue("wireThickness", 0), 0, 5),
    poreOpacity: clamp(numberValue("poreOpacity", 0.58), 0, 1)
  };

  const rng = mulberry32(seed);
  const seedLayout = generateSeedPoints(uniformity, cellCount, width, height, depth, rng, targetCv, clusterCount, poresPerCluster, clusterCv);
  const points = seedLayout.points;
  const poreMesh = buildPoreSurfaceMesh(points, width, height, depth, poreDiameter / 2, wallThickness, resolution);
  const graphPoreMesh = buildPoreSurfaceMesh(points, width, height, depth, poreDiameter / 2, 0, resolution);
  const previewMeshData = buildGlobalMesh(width, height, depth, poreMesh);
  const graphMeshData = buildGlobalMesh(width, height, depth, graphPoreMesh);
  const exports = buildExports(graphMeshData);
  const neighborStats = nearestNeighborStats(points);

  state.meshData = {
    preview: previewMeshData,
    graph: graphMeshData,
    metrics: { width, height, depth, cellCount, poreDiameter, wallThickness, resolution, seed }
  };
  state.stlText = exports.stlText;
  state.objText = exports.objText;
  state.nodesCsv = exports.nodesCsv;
  state.edgesCsv = exports.edgesCsv;
  state.facesCsv = exports.facesCsv;

  updateScene(width, height, depth, previewMeshData, colors);
  const labels = { random: "随机", uniform: "均匀 / 三维格点扰动", clustered: "不均匀 / 聚簇随机" };
  $("metrics").innerHTML = [
    `结构均匀度: ${labels[uniformity] || labels.random}`,
    `目标变异系数: ${targetCv.toFixed(3)}`,
    `第一次生成中心数: ${seedLayout.primaryCount}`,
    `团聚区数量: ${seedLayout.clusterCount}`,
    `每个团聚区泡孔数: ${seedLayout.poresPerCluster}`,
    `团聚区目标变异系数: ${clusterCv.toFixed(3)}`,
    `第二次团聚泡孔中心数: ${seedLayout.clusteredCount}`,
    `最近邻距离均值: ${neighborStats.mean.toFixed(2)} um`,
    `最近邻距离变异系数: ${neighborStats.cv.toFixed(3)}`,
    `输入泡孔直径: ${poreDiameter.toFixed(2)} um`,
    `壁厚: ${wallThickness.toFixed(2)} um`,
    `泡孔透明度: ${colors.poreOpacity.toFixed(2)}`,
    `泡孔线框粗细: ${colors.wireThickness.toFixed(2)}`,
    `表面三角面片数: ${previewMeshData.faces.length}`,
    `网络导出壁厚: 0 um`,
    `网络节点数: ${graphMeshData.nodes.length}`,
    `网络连线数: ${graphMeshData.edges.length}`,
    `边界断开连线数: ${graphMeshData.disconnectedBoundaryEdgeCount}`,
    `说明: 浏览器版输出泡孔表面网格；严格STEP/体网格请使用Python后端导出器。`
  ].join("<br>");
}

function ensureGenerated() {
  if (!state.meshData) generateRve();
}

function init() {
  initScene();
  window.sphere3dRve = { state, generateRve };
  $("uniformity").addEventListener("change", () => {
    $("targetCv").value = (DEFAULT_TARGET_CV[textValue("uniformity", "random")] || 0.6).toFixed(2);
    generateRve();
  });
  [
    "width", "height", "depth", "cellCount", "poreDiameter", "wallThickness", "targetCv",
    "clusterCount", "poresPerCluster", "clusterCv", "surfaceResolution", "seed",
    "bgColor", "boxColor", "rveFillColor", "poreColor", "wireColor", "wireThickness", "poreOpacity"
  ].forEach((id) => $(id).addEventListener("input", generateRve));
  $("generate").addEventListener("click", generateRve);
  $("downloadStl").addEventListener("click", () => {
    ensureGenerated();
    downloadBlob(new Blob([state.stlText], { type: "model/stl" }), `${outputBaseName()}_pores_surface.stl`);
  });
  $("downloadObj").addEventListener("click", () => {
    ensureGenerated();
    downloadBlob(new Blob([state.objText], { type: "text/plain;charset=utf-8" }), `${outputBaseName()}_pores_surface.obj`);
  });
  $("downloadNodes").addEventListener("click", () => {
    ensureGenerated();
    downloadBlob(new Blob([state.nodesCsv], { type: "text/csv;charset=utf-8" }), `${outputBaseName()}_nodes_matrix.csv`);
  });
  $("downloadEdges").addEventListener("click", () => {
    ensureGenerated();
    downloadBlob(new Blob([state.edgesCsv], { type: "text/csv;charset=utf-8" }), `${outputBaseName()}_edges_matrix.csv`);
  });
  $("downloadFaces").addEventListener("click", () => {
    ensureGenerated();
    downloadBlob(new Blob([state.facesCsv], { type: "text/csv;charset=utf-8" }), `${outputBaseName()}_faces_matrix.csv`);
  });
  generateRve();
}

init();
