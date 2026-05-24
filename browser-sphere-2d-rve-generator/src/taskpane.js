const state = {
  svgText: "",
  dxfText: "",
  nodesCsv: "",
  edgesCsv: "",
  metrics: null
};

const $ = (id) => document.getElementById(id);

const DEFAULT_TARGET_CV = {
  uniform: 0.15,
  random: 0.6,
  clustered: 0.85
};

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function textValue(id, fallback) {
  return $(id).value || fallback;
}

function colorValue(id, fallback) {
  const value = textValue(id, fallback).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function randomPoints(count, width, height, rng, margin = 0) {
  if (count <= 0) return [];
  const xMin = Math.min(margin, width / 2);
  const yMin = Math.min(margin, height / 2);
  const usableWidth = Math.max(width - 2 * xMin, 1e-9);
  const usableHeight = Math.max(height - 2 * yMin, 1e-9);
  return Array.from({ length: count }, () => [xMin + rng() * usableWidth, yMin + rng() * usableHeight]);
}

function heterogeneousPoints(count, width, height, rng, targetCv, margin = 0) {
  if (count <= 0) return [];
  const groupCount = clamp(Math.round(Math.sqrt(count) / (1.8 + targetCv)), 1, Math.min(10, count));
  const baseSpread = Math.min(width, height) / Math.max(6, Math.sqrt(count) * 1.25);
  const spread = baseSpread * clamp(1.1 - targetCv * 0.65, 0.18, 0.85);
  const centerSeeds = randomPoints(groupCount, width, height, rng, margin);
  const centers = lloydRelax(centerSeeds, width, height, 3, margin);
  const points = [];

  while (points.length < count) {
    const center = centers[Math.floor(rng() * centers.length)];
    const angle = rng() * Math.PI * 2;
    const radius = spread * Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-9)));
    const x = clamp(center[0] + Math.cos(angle) * radius, margin, width - margin);
    const y = clamp(center[1] + Math.sin(angle) * radius, margin, height - margin);
    points.push([x, y]);
  }

  return points;
}

function generateDistributedPoints(mode, count, width, height, rng, targetCv, margin) {
  const base = randomPoints(count, width, height, rng, margin);
  if (count <= 0) return [];
  if (mode === "uniform") {
    const iterations = Math.round(clamp((0.72 - targetCv) * 14, 1, 10));
    return lloydRelax(base, width, height, iterations, margin);
  }
  if (mode === "clustered") {
    return heterogeneousPoints(count, width, height, rng, targetCv, margin);
  }
  if (targetCv < 0.48) {
    const iterations = Math.round(clamp((0.48 - targetCv) * 10, 1, 4));
    return lloydRelax(base, width, height, iterations, margin);
  }
  if (targetCv > 0.72) {
    return heterogeneousPoints(count, width, height, rng, targetCv, margin);
  }
  return base;
}

function pointsAroundClusterCenters(centers, totalClusteredCount, poresPerCluster, width, height, rng, clusterCv, margin) {
  const points = [];
  if (centers.length === 0 || totalClusteredCount <= 0) return points;
  const nominalSpacing = Math.sqrt((width * height) / Math.max(totalClusteredCount, 1));
  const spread = nominalSpacing * clamp(1.15 - clusterCv * 0.65, 0.12, 0.9);

  for (let clusterIndex = 0; clusterIndex < centers.length && points.length < totalClusteredCount; clusterIndex += 1) {
    const center = centers[clusterIndex];
    const countForCluster = Math.min(poresPerCluster, totalClusteredCount - points.length);
    for (let j = 0; j < countForCluster; j += 1) {
      const angle = rng() * Math.PI * 2;
      const radius = spread * Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-9)));
      const x = clamp(center[0] + Math.cos(angle) * radius, margin, width - margin);
      const y = clamp(center[1] + Math.sin(angle) * radius, margin, height - margin);
      points.push([x, y]);
    }
  }

  return points;
}

function polygonCentroid(points) {
  const areaSigned = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);

  if (Math.abs(areaSigned) < 1e-9) {
    return [
      points.reduce((sum, p) => sum + p[0], 0) / points.length,
      points.reduce((sum, p) => sum + p[1], 0) / points.length
    ];
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }

  const factor = 1 / (3 * areaSigned);
  return [cx * factor, cy * factor];
}

function lloydRelax(points, width, height, iterations, margin = 0) {
  let relaxed = points.map((p) => [...p]);

  for (let iter = 0; iter < iterations; iter += 1) {
    const delaunay = d3.Delaunay.from(relaxed);
    const voronoi = delaunay.voronoi([margin, margin, width - margin, height - margin]);
    relaxed = relaxed.map((point, i) => {
      const poly = voronoi.cellPolygon(i);
      if (!poly || poly.length < 4) return point;
      const centroid = polygonCentroid(poly.slice(0, -1));
      return [clamp(centroid[0], margin, width - margin), clamp(centroid[1], margin, height - margin)];
    });
  }

  return relaxed;
}

function generateSeedPoints(mode, count, width, height, rng, targetCv, margin, clusterCount, poresPerCluster, clusterCv) {
  const effectiveClusterCount = clamp(Math.round(clusterCount), 0, Math.min(50, count));
  const effectivePoresPerCluster = clamp(Math.round(poresPerCluster), 0, count);
  const requestedClusteredCount = effectiveClusterCount * effectivePoresPerCluster;
  const clusteredCount = Math.min(count, requestedClusteredCount);
  const primaryCount = Math.max(0, count - clusteredCount);
  const primaryPoints = generateDistributedPoints(mode, primaryCount, width, height, rng, targetCv, margin);
  const clusterCenters = generateDistributedPoints(mode, effectiveClusterCount, width, height, rng, targetCv, margin);
  const clusteredPoints = pointsAroundClusterCenters(
    clusterCenters,
    clusteredCount,
    effectivePoresPerCluster,
    width,
    height,
    rng,
    clusterCv,
    margin
  );

  return {
    points: [...primaryPoints, ...clusteredPoints],
    clusterCenters,
    primaryCount,
    clusterCount: effectiveClusterCount,
    poresPerCluster: effectivePoresPerCluster,
    requestedClusteredCount,
    clusteredCount,
    overflowCount: Math.max(0, requestedClusteredCount - count)
  };
}

function nearestNeighborStats(points) {
  const distances = points.map((p, i) => {
    let nearest = Infinity;
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue;
      const q = points[j];
      nearest = Math.hypot(p[0] - q[0], p[1] - q[1]);
    }
    return nearest;
  });
  const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const variance = distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / distances.length;
  return { mean, cv: Math.sqrt(variance) / Math.max(mean, 1e-9) };
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a[0] * b[1] - a[1] * b[0];
  }
  return Math.abs(sum) / 2;
}

function circlePolygon(cx, cy, radius, segments) {
  return Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });
}

function lineIntersection(a, b, normal, offset) {
  const da = normal[0] * a[0] + normal[1] * a[1] - offset;
  const db = normal[0] * b[0] + normal[1] * b[1] - offset;
  const denominator = da - db;
  if (Math.abs(denominator) < 1e-12) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  const t = clamp(da / denominator, 0, 1);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

function clipPolygonByHalfPlane(points, normal, offset) {
  points = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (points.length === 0) return [];
  const clipped = [];
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const previous = points[(i + points.length - 1) % points.length];
    const currentInside = normal[0] * current[0] + normal[1] * current[1] <= offset + 1e-9;
    const previousInside = normal[0] * previous[0] + normal[1] * previous[1] <= offset + 1e-9;

    if (currentInside !== previousInside) {
      clipped.push(lineIntersection(previous, current, normal, offset));
    }
    if (currentInside) {
      clipped.push(current);
    }
  }
  return clipped;
}

function clipPoreCircle(center, points, index, width, height, radius, wallThickness, segments) {
  const margin = wallThickness / 2;
  let poly = circlePolygon(center[0], center[1], radius, segments);

  poly = clipPolygonByHalfPlane(poly, [-1, 0], -margin);
  poly = clipPolygonByHalfPlane(poly, [1, 0], width - margin);
  poly = clipPolygonByHalfPlane(poly, [0, -1], -margin);
  poly = clipPolygonByHalfPlane(poly, [0, 1], height - margin);

  for (let j = 0; j < points.length; j += 1) {
    if (j === index || poly.length < 3) continue;
    const other = points[j];
    const dx = other[0] - center[0];
    const dy = other[1] - center[1];
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-9) continue;

    const nx = dx / distance;
    const ny = dy / distance;
    const offset = center[0] * nx + center[1] * ny + Math.max(0, (distance - wallThickness) / 2);
    poly = clipPolygonByHalfPlane(poly, [nx, ny], offset);
  }

  return poly;
}

function pathFromPolygon(points) {
  if (points.length < 3) return "";
  return `M${points.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join("L")}Z`;
}

function dxfNumber(value) {
  return Number(value).toFixed(6).replace(/\.?0+$/, "");
}

function dxfLayer(name, color) {
  return [
    "0", "LAYER",
    "2", name,
    "70", "0",
    "62", String(color),
    "6", "CONTINUOUS"
  ];
}

function dxfClosedPolyline(layer, points, height, flipY = true) {
  const lines = [
    "0", "LWPOLYLINE",
    "8", layer,
    "90", String(points.length),
    "70", "1"
  ];

  points.forEach((point) => {
    const x = point[0];
    const y = flipY ? height - point[1] : point[1];
    lines.push("10", dxfNumber(x), "20", dxfNumber(y));
  });

  return lines;
}

function buildNetworkMatrices(width, height, porePolygons) {
  const tolerance = 1e-6;
  const nodeKeyToId = new Map();
  const nodes = [];
  const edges = [];
  const edgeKeys = new Set();
  let disconnectedBoundaryEdgeCount = 0;

  function pointToGraphCoordinate(point, flipY) {
    return {
      x: Number(point[0]),
      y: flipY ? height - Number(point[1]) : Number(point[1])
    };
  }

  function addNode(point, flipY) {
    const coordinate = pointToGraphCoordinate(point, flipY);
    const key = `${Math.round(coordinate.x / tolerance)}:${Math.round(coordinate.y / tolerance)}`;
    if (nodeKeyToId.has(key)) {
      return nodeKeyToId.get(key);
    }
    const id = nodes.length + 1;
    nodeKeyToId.set(key, id);
    nodes.push({ id, x: coordinate.x, y: coordinate.y });
    return id;
  }

  function boundarySides(coordinate) {
    const sides = [];
    if (Math.abs(coordinate.x) <= tolerance) sides.push("left");
    if (Math.abs(coordinate.x - width) <= tolerance) sides.push("right");
    if (Math.abs(coordinate.y) <= tolerance) sides.push("bottom");
    if (Math.abs(coordinate.y - height) <= tolerance) sides.push("top");
    return sides;
  }

  function isRveBoundarySegment(pointA, pointB, flipY) {
    const coordinateA = pointToGraphCoordinate(pointA, flipY);
    const coordinateB = pointToGraphCoordinate(pointB, flipY);
    const sidesA = boundarySides(coordinateA);
    const sidesB = boundarySides(coordinateB);
    return sidesA.some((side) => sidesB.includes(side));
  }

  function addClosedPolyline(points, flipY) {
    if (points.length < 2) return;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance) continue;
      const node1 = addNode(a, flipY);
      const node2 = addNode(b, flipY);
      if (node1 === node2) continue;
      const edgeKey = node1 < node2 ? `${node1}:${node2}` : `${node2}:${node1}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      if (isRveBoundarySegment(a, b, flipY)) {
        disconnectedBoundaryEdgeCount += 1;
        edges.push({ id: edges.length + 1, node1: "", node2: "", disconnected: true });
      } else {
        edges.push({ id: edges.length + 1, node1, node2, disconnected: false });
      }
    }
  }

  porePolygons.forEach((poly) => addClosedPolyline(poly, true));

  return {
    nodesCsv: [
      "Node_ID,X_Coordinate,Y_Coordinate",
      ...nodes.map((node) => `${node.id},${dxfNumber(node.x)},${dxfNumber(node.y)}`)
    ].join("\r\n") + "\r\n",
    edgesCsv: [
      "Edge_ID,Node1_ID,Node2_ID",
      ...edges.map((edge) => `${edge.id},${edge.node1},${edge.node2}`)
    ].join("\r\n") + "\r\n",
    nodeCount: nodes.length,
    edgeCount: edges.length,
    connectedEdgeCount: edges.length - disconnectedBoundaryEdgeCount,
    disconnectedBoundaryEdgeCount
  };
}

function buildComsolDxf(width, height, porePolygons) {
  const outerBoundary = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height]
  ];
  const lines = [
    "0", "SECTION",
    "2", "HEADER",
    "9", "$ACADVER",
    "1", "AC1024",
    "9", "$INSUNITS",
    "70", "13",
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "TABLES",
    "0", "TABLE",
    "2", "LAYER",
    "70", "2",
    ...dxfLayer("PORE_WALL_DOMAIN", 3),
    ...dxfLayer("AIR_DOMAIN", 5),
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "ENTITIES",
    "999", "COMSOL import layers: PORE_WALL_DOMAIN contains the closed wall-domain boundary set including the exterior RVE boundary and pore boundaries; AIR_DOMAIN contains closed pore loops for air regions. RVE_MODEL_BOUNDARY is intentionally not exported.",
    ...dxfClosedPolyline("PORE_WALL_DOMAIN", outerBoundary, height, false)
  ];

  porePolygons.forEach((poly) => {
    if (poly.length >= 3) {
      lines.push(...dxfClosedPolyline("PORE_WALL_DOMAIN", poly, height, true));
      lines.push(...dxfClosedPolyline("AIR_DOMAIN", poly, height, true));
    }
  });

  lines.push("0", "ENDSEC", "0", "EOF");
  return `${lines.join("\r\n")}\r\n`;
}

function updateUniformityDefaults() {
  const mode = textValue("uniformity", "random");
  $("targetCv").value = DEFAULT_TARGET_CV[mode].toFixed(2);
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

function generateRve() {
  const width = Math.max(1, numberValue("width", 100));
  const height = Math.max(1, numberValue("height", 100));
  const cellCount = clamp(Math.round(numberValue("cellCount", 80)), 3, 2000);
  const poreDiameter = Math.max(0.1, numberValue("poreDiameter", 18));
  const wallThickness = Math.max(0, numberValue("wallThickness", 1.5));
  const uniformity = textValue("uniformity", "random");
  const targetCv = clamp(numberValue("targetCv", DEFAULT_TARGET_CV[uniformity] || 0.6), 0.05, 1.5);
  const clusterCountInput = clamp(Math.round(numberValue("clusterCount", 5)), 0, 50);
  const poresPerClusterInput = clamp(Math.round(numberValue("poresPerCluster", 10)), 0, cellCount);
  const clusterCv = clamp(numberValue("clusterCv", 0.85), 0.05, 1.5);
  const seed = Math.round(numberValue("seed", 42));
  const colors = {
    bg: colorValue("bgColor", "#f8f8f2"),
    wall: colorValue("cellColor", "#dfe8e6"),
    wallStroke: colorValue("cellStrokeColor", "#344850"),
    pore: colorValue("poreColor", "#ffffff"),
    poreStroke: colorValue("poreStrokeColor", "#147a7e"),
    seed: colorValue("seedColor", "#162326")
  };

  const rng = mulberry32(seed);
  const seedMargin = Math.min(width, height) * 0.02;
  const seedLayout = generateSeedPoints(
    uniformity,
    cellCount,
    width,
    height,
    rng,
    targetCv,
    seedMargin,
    clusterCountInput,
    poresPerClusterInput,
    clusterCv
  );
  const points = seedLayout.points;
  const neighborStats = nearestNeighborStats(points);
  const requestedRadius = poreDiameter / 2;
  const circleSegments = clamp(Math.round(48 + poreDiameter * 2), 56, 160);
  const porePolygons = [];
  const graphPorePolygons = [];
  let poreArea = 0;
  let clippedCount = 0;

  for (let i = 0; i < points.length; i += 1) {
    const poly = clipPoreCircle(points[i], points, i, width, height, requestedRadius, wallThickness, circleSegments);
    if (poly.length < 3 || polygonArea(poly) <= 1e-8) continue;
    const area = polygonArea(poly);
    const circleArea = Math.PI * requestedRadius * requestedRadius;
    if (area < circleArea * 0.985) clippedCount += 1;
    poreArea += area;
    porePolygons.push(poly);

    const graphPoly = clipPoreCircle(points[i], points, i, width, height, requestedRadius, 0, circleSegments);
    if (graphPoly.length >= 3 && polygonArea(graphPoly) > 1e-8) {
      graphPorePolygons.push(graphPoly);
    }
  }

  const renderedPoreFraction = poreArea / Math.max(width * height, 1e-9);
  const meanRenderedDiameter = Math.sqrt((4 * (poreArea / Math.max(porePolygons.length, 1))) / Math.PI);
  const px = 900;
  const py = Math.max(320, Math.round(px * height / width));
  const strokeWidth = Math.max(width, height) * 0.0025;
  const seedRadius = Math.max(width, height) * 0.004;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${py}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Sphere 2D RVE">
  <style>
    .bg{fill:${colors.bg}}.wall{fill:${colors.wall};stroke:${colors.wallStroke};stroke-width:${strokeWidth}}.pore{fill:${colors.pore};stroke:${colors.poreStroke};stroke-width:${strokeWidth * 0.65}}.seed{fill:${colors.seed}}
  </style>
  <rect class="wall" x="0" y="0" width="${width}" height="${height}"/>
  <rect class="bg" x="0" y="0" width="${width}" height="${height}" fill-opacity="0"/>
  ${porePolygons.map((poly) => `<path d="${pathFromPolygon(poly)}" class="pore"/>`).join("\n  ")}
  ${points.map((p) => `<circle class="seed" cx="${p[0].toFixed(3)}" cy="${p[1].toFixed(3)}" r="${seedRadius}"/>`).join("\n  ")}
</svg>`;

  state.svgText = svg;
  state.dxfText = buildComsolDxf(width, height, porePolygons);
  const networkMatrices = buildNetworkMatrices(width, height, graphPorePolygons);
  state.nodesCsv = networkMatrices.nodesCsv;
  state.edgesCsv = networkMatrices.edgesCsv;
  state.metrics = {
    width,
    height,
    cellCount,
    poreDiameter,
    wallThickness,
    uniformity,
    targetCv,
    clusterCv,
    requestedRadius,
    meanRenderedDiameter,
    renderedPoreFraction,
    nearestNeighborMean: neighborStats.mean,
    nearestNeighborCv: neighborStats.cv,
    clippedCount,
    clusterCount: seedLayout.clusterCount || 0,
    poresPerCluster: seedLayout.poresPerCluster || 0,
    primaryCount: seedLayout.primaryCount || 0,
    clusteredCount: seedLayout.clusteredCount || 0,
    requestedClusteredCount: seedLayout.requestedClusteredCount || 0,
    overflowCount: seedLayout.overflowCount || 0,
    graphNodeCount: networkMatrices.nodeCount,
    graphEdgeCount: networkMatrices.edgeCount,
    graphConnectedEdgeCount: networkMatrices.connectedEdgeCount,
    graphDisconnectedBoundaryEdgeCount: networkMatrices.disconnectedBoundaryEdgeCount,
    graphWallThickness: 0
  };

  const uniformityLabel = {
    random: "随机",
    uniform: "均匀 / Lloyd松弛",
    clustered: "不均匀 / 聚簇随机"
  }[uniformity] || "随机";

  $("preview").innerHTML = svg;
  const metrics = [
    `结构均匀度: ${uniformityLabel}`,
    `目标变异系数: ${targetCv.toFixed(3)}`,
    `第一次生成中心数: ${seedLayout.primaryCount}`,
    `团聚区数量: ${seedLayout.clusterCount}`,
    `每个团聚区泡孔数: ${seedLayout.poresPerCluster}`,
    `团聚区目标变异系数: ${clusterCv.toFixed(3)}`,
    `第二次团聚泡孔中心数: ${seedLayout.clusteredCount}`,
    `最近邻距离均值: ${neighborStats.mean.toFixed(2)} um`,
    `最近邻距离变异系数: ${neighborStats.cv.toFixed(3)}`,
    `输入泡孔直径: ${poreDiameter.toFixed(2)} um`,
    `估计渲染等效直径: ${formatNumber(meanRenderedDiameter)} um`,
    `壁厚: ${wallThickness.toFixed(2)} um`,
    `发生接触/边界裁剪的泡孔数: ${clippedCount} / ${cellCount}`,
    `网络导出壁厚: 0 um`,
    `网络节点数: ${networkMatrices.nodeCount}`,
    `网络连线数: ${networkMatrices.edgeCount}`,
    `边界断开连线数: ${networkMatrices.disconnectedBoundaryEdgeCount}`,
    `渲染泡孔面积占比估计: ${renderedPoreFraction.toFixed(3)}`,
    `说明: 本模型不计算发泡倍率和孔隙率；泡孔直径、泡孔数量、壁厚可同时输入。`
  ];

  if (seedLayout.overflowCount > 0) {
    metrics.splice(
      7,
      0,
      `团聚区设置超出总泡孔数，已截断: ${seedLayout.overflowCount}`
    );
  }

  $("metrics").innerHTML = metrics.join("<br>");
}

async function svgToPngBase64(svgText) {
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    img.src = url;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

function outputBaseName() {
  const metrics = state.metrics || {};
  const width = Math.round(metrics.width || numberValue("width", 100));
  const height = Math.round(metrics.height || numberValue("height", 100));
  const cells = Math.round(metrics.cellCount || numberValue("cellCount", 80));
  const diameter = Number(metrics.poreDiameter || numberValue("poreDiameter", 18)).toFixed(1).replace(".", "p");
  const wall = Number(metrics.wallThickness || numberValue("wallThickness", 1.5)).toFixed(1).replace(".", "p");
  const seed = Math.round(numberValue("seed", 42));
  return `sphere_2d_rve_${width}x${height}um_${cells}cells_d${diameter}_wall${wall}_seed${seed}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadSvg() {
  if (!state.svgText) generateRve();
  downloadBlob(
    new Blob([state.svgText], { type: "image/svg+xml;charset=utf-8" }),
    `${outputBaseName()}.svg`
  );
  $("metrics").innerHTML += "<br>已生成SVG下载。";
}

async function downloadPng() {
  if (!state.svgText) generateRve();
  try {
    const imageBase64 = await svgToPngBase64(state.svgText);
    const bytes = Uint8Array.from(atob(imageBase64), (char) => char.charCodeAt(0));
    downloadBlob(new Blob([bytes], { type: "image/png" }), `${outputBaseName()}.png`);
    $("metrics").innerHTML += "<br>已生成PNG下载。";
  } catch (error) {
    $("metrics").innerHTML += `<br>PNG下载失败: ${error.message}`;
  }
}

function downloadDxf() {
  if (!state.dxfText) generateRve();
  downloadBlob(
    new Blob([state.dxfText], { type: "application/dxf;charset=utf-8" }),
    `${outputBaseName()}_comsol_closed_geometry.dxf`
  );
  $("metrics").innerHTML += "<br>已生成COMSOL闭合几何DXF下载。";
}

function downloadNodesCsv() {
  if (!state.nodesCsv) generateRve();
  downloadBlob(
    new Blob([state.nodesCsv], { type: "text/csv;charset=utf-8" }),
    `${outputBaseName()}_nodes_matrix.csv`
  );
  $("metrics").innerHTML += "<br>已生成节点坐标矩阵CSV下载。";
}

function downloadEdgesCsv() {
  if (!state.edgesCsv) generateRve();
  downloadBlob(
    new Blob([state.edgesCsv], { type: "text/csv;charset=utf-8" }),
    `${outputBaseName()}_edges_matrix.csv`
  );
  $("metrics").innerHTML += "<br>已生成连线邻接表CSV下载。";
}

function init() {
  ["bgColor", "cellColor", "cellStrokeColor", "poreColor", "poreStrokeColor", "seedColor"].forEach((id) => {
    $(id).addEventListener("input", generateRve);
  });
  $("uniformity").addEventListener("change", () => {
    updateUniformityDefaults();
    generateRve();
  });
  $("clusterCount").addEventListener("change", generateRve);
  $("poresPerCluster").addEventListener("change", generateRve);
  $("clusterCv").addEventListener("change", generateRve);
  $("generate").addEventListener("click", generateRve);
  $("downloadSvg").addEventListener("click", downloadSvg);
  $("downloadPng").addEventListener("click", downloadPng);
  $("downloadDxf").addEventListener("click", downloadDxf);
  $("downloadNodes").addEventListener("click", downloadNodesCsv);
  $("downloadEdges").addEventListener("click", downloadEdgesCsv);
  generateRve();
}

window.addEventListener("DOMContentLoaded", init);
