import type { Vec2, Vec3, CrossSection, Manifold } from "manifold-3d";
import type { ManifoldToplevel } from "manifold-3d";
import init from "manifold-3d";
import manifold_wasm from "manifold-3d/manifold.wasm?url";

// NOTE: all values are in mm

export const CLIP_HEIGHT = 12;

// Load manifold 3d
class ManifoldModule {
  private static wasm: ManifoldToplevel | undefined = undefined;
  static async get(): Promise<ManifoldToplevel> {
    if (this.wasm !== undefined) {
      return this.wasm;
    }

    this.wasm = await init({ locateFile: () => manifold_wasm });

    await this.wasm.setup();
    return this.wasm;
  }
}

// Generates a CCW arc (quarter)
function generateArc({
  center,
  radius,
}: {
  center: Vec2;
  radius: number;
}): Vec2[] {
  // Number of segments (total points - 2)
  const N_SEGMENTS = 10;
  const N_POINTS = N_SEGMENTS + 2;

  const pts: Vec2[] = [];
  for (let i = 0; i < N_POINTS; i++) {
    const angle = (i * (Math.PI / 2)) / (N_POINTS - 1);

    pts.push([
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
    ]);
  }

  return pts;
}

// Rounded rect centered at (0,0)
async function roundedRectangle(
  size: Vec2,
  cornerRadius: number,
): Promise<CrossSection> {
  const { CrossSection } = await ManifoldModule.get();
  const w = size[0];
  const h = size[1];
  const basicArc = generateArc({
    center: [w / 2 - cornerRadius, h / 2 - cornerRadius],
    radius: cornerRadius,
  });

  // Reuse the basic arc and mirror & reverse as necessary for each corner of
  // the cube
  const topRight: Vec2[] = basicArc;
  const topLeft: Vec2[] = Array.from(basicArc.map(([x, y]) => [-x, y]));
  topLeft.reverse();
  const bottomLeft: Vec2[] = basicArc.map(([x, y]) => [-x, -y]);
  const bottomRight: Vec2[] = Array.from(basicArc.map(([x, y]) => [x, -y]));
  bottomRight.reverse();

  const vertices: Vec2[] = [
    ...topRight,
    ...topLeft,
    ...bottomLeft,
    ...bottomRight,
  ];

  return new CrossSection(vertices);
}

async function clipRCrossSection(): Promise<CrossSection> {
  const { CrossSection } = await ManifoldModule.get();

  const vertices: Vec2[] = [
    [0.95, 0],
    [2.45, 0],
    [2.45, 3.7],
    [3.05, 4.3],
    [3.05, 5.9],
    [2.45, 6.5],
    [0.95, 6.5],
    [0.95, 0],
  ];

  return new CrossSection(vertices).rotate(180);
}

// The skadis clips, starting at the origin and pointing in -Z
// If chamfer is true, the bottom of the clip has a 45 deg chamfer
// (to print without supports)
export async function clips(
  chamfer: boolean = false,
): Promise<[Manifold, Manifold]> {
  const clipR = (await clipRCrossSection()).extrude(CLIP_HEIGHT);
  const clipL = (await clipRCrossSection()).mirror([1, 0]).extrude(CLIP_HEIGHT);

  if (!chamfer) {
    return [clipR, clipL];
  }

  const n: Vec3 = [0, 1, 1]; /* a 45deg normal defining the trim plane */
  return [clipR.trimByPlane(n, 0), clipL.trimByPlane(n, 0)];
}

// Create consistent vent holes on all sides except back (which has connectors)
async function createVentHoles(
  height: number,
  width: number,
  depth: number,
  wall: number,
  bottom: number,
  radius: number,
): Promise<Manifold> {
  const manifold = await ManifoldModule.get();

  const EDGE_CLEARANCE = 3; // mm: hole must be at least this far from any wall edge
  const MIN_GAP = 4; // mm: minimum spacing between adjacent holes (>= 3mm)

  // Hole rectangle dimensions (before rotation). "long" ≈ along local major axis
  // Use small rectangles tilted 45° from vertical. Keep consistent across all faces.
  const HOLE_LONG = 7; // mm (slightly larger to reduce hole count)
  const HOLE_SHORT = 3; // mm

  // Build a true rectangle and rotate it 45° in-plane to achieve tilt
  const hole2D = new manifold.CrossSection([
    [-HOLE_LONG / 2, -HOLE_SHORT / 2],
    [HOLE_LONG / 2, -HOLE_SHORT / 2],
    [HOLE_LONG / 2, HOLE_SHORT / 2],
    [-HOLE_LONG / 2, HOLE_SHORT / 2],
  ]).rotate(45); // 2D rotation (degrees)

  // For a rectangle rotated by 45°, the axis-aligned span along either in-plane axis
  // equals (w*cos45 + h*sin45) = (w + h)/sqrt(2)
  const SQRT2 = Math.SQRT2;
  const HOLE_SPAN_PLANAR = (HOLE_LONG + HOLE_SHORT) / SQRT2; // mm, along either axis on the face plane

  // Compute evenly distributed positions along an axis centered at 0 (e.g., X or Y axes)
  const computeCenteredAxisPositions = (
    totalSpan: number,
    holeSpan: number,
    edgeClearance: number,
    minGap: number,
    maxAxisCount?: number,
  ): { positions: number[]; gapBetween: number } => {
    const usable = totalSpan - 2 * edgeClearance;
    if (usable < holeSpan) return { positions: [], gapBetween: 0 };

    const maxHolesWithMinGap = Math.max(
      1,
      Math.floor((usable + minGap) / (holeSpan + minGap)),
    );

    let chosenCount = maxHolesWithMinGap;
    let chosenGap = minGap;
    if (maxAxisCount !== undefined && chosenCount > maxAxisCount) {
      // Increase gap until we are at or below the axis cap
      let trialGap = minGap;
      while (chosenCount > maxAxisCount) {
        trialGap += 1; // increase by 1mm steps
        const count = Math.max(
          1,
          Math.floor((usable + trialGap) / (holeSpan + trialGap)),
        );
        chosenCount = count;
        chosenGap = trialGap;
        if (trialGap > 30) break; // safety stop
      }
    }

    const baseUsed = chosenCount * holeSpan + (chosenCount - 1) * chosenGap;
    const leftover = Math.max(0, usable - baseUsed);
    const gapBetween = chosenCount > 1 ? chosenGap + leftover / (chosenCount - 1) : 0;

    const start = -totalSpan / 2 + edgeClearance + holeSpan / 2;
    const step = holeSpan + gapBetween;

    const positions: number[] = [];
    for (let i = 0; i < chosenCount; i++) {
      positions.push(start + i * step);
    }
    return { positions, gapBetween };
  };

  // Compute evenly distributed positions along Z from 0..height
  const computeVerticalPositions = (
    totalSpan: number,
    holeSpan: number,
    edgeClearance: number,
    minGap: number,
    maxAxisCount?: number,
  ): { positions: number[]; gapBetween: number } => {
    const usable = totalSpan - 2 * edgeClearance;
    if (usable < holeSpan) return { positions: [], gapBetween: 0 };

    const maxHolesWithMinGap = Math.max(
      1,
      Math.floor((usable + minGap) / (holeSpan + minGap)),
    );

    let chosenCount = maxHolesWithMinGap;
    let chosenGap = minGap;
    if (maxAxisCount !== undefined && chosenCount > maxAxisCount) {
      let trialGap = minGap;
      while (chosenCount > maxAxisCount) {
        trialGap += 1;
        const count = Math.max(
          1,
          Math.floor((usable + trialGap) / (holeSpan + trialGap)),
        );
        chosenCount = count;
        chosenGap = trialGap;
        if (trialGap > 30) break;
      }
    }

    const baseUsed = chosenCount * holeSpan + (chosenCount - 1) * chosenGap;
    const leftover = Math.max(0, usable - baseUsed);
    const gapBetween = chosenCount > 1 ? chosenGap + leftover / (chosenCount - 1) : 0;

    const start = edgeClearance + holeSpan / 2; // measured from z=0 up to z=height
    const step = holeSpan + gapBetween;

    const positions: number[] = [];
    for (let i = 0; i < chosenCount; i++) {
      positions.push(start + i * step);
    }
    return { positions, gapBetween };
  };

  // Axis caps to avoid huge grids that kill performance
  const MAX_AXIS_COUNT_WIDTH = 12;
  const MAX_AXIS_COUNT_DEPTH = 12;
  const MAX_AXIS_COUNT_HEIGHT = 12;

  // Precompute positions along each axis
  const xPositionsFront = computeCenteredAxisPositions(
    width,
    HOLE_SPAN_PLANAR,
    EDGE_CLEARANCE,
    MIN_GAP,
    MAX_AXIS_COUNT_WIDTH,
  ).positions;
  const yPositionsSide = computeCenteredAxisPositions(
    depth,
    HOLE_SPAN_PLANAR,
    EDGE_CLEARANCE,
    MIN_GAP,
    MAX_AXIS_COUNT_DEPTH,
  ).positions;
  const zPositions = computeVerticalPositions(
    height,
    HOLE_SPAN_PLANAR,
    EDGE_CLEARANCE,
    MIN_GAP,
    MAX_AXIS_COUNT_HEIGHT,
  ).positions;

  // Bottom face grid uses X and Y axes
  // const xPositionsBottom = xPositionsFront;
  // const yPositionsBottom = yPositionsSide;

  // Pre-extruded prisms for reuse
  const wallPrism = hole2D.extrude(wall + 3); // ensure we pass completely through wall and slightly beyond
  const bottomPrism = hole2D.extrude(bottom + 0.8);

  // Pre-rotated orientations
  const leftPrism = wallPrism.rotate(0, 90, 0);
  const rightPrism = wallPrism.rotate(0, -90, 0);
  const frontPrism = wallPrism.rotate(90, 0, 0); // extrude inward toward -Y with our translation at +Y

  // Helpers to union arrays quickly
  const unionAll = (parts: Manifold[]): Manifold | undefined => {
    if (parts.length === 0) return undefined;
    return parts.reduce((acc, cur) => (acc ? acc.add(cur) : cur));
  };

  // Left side (x = -width/2). Extrude through wall thickness along X.
  const leftHoles: Manifold[] = [];
  for (const y of yPositionsSide) {
    for (const z of zPositions) {
      leftHoles.push(leftPrism.translate(-width / 2 - 1, y, z));
    }
  }

  // Right side (x = +width/2)
  const rightHoles: Manifold[] = [];
  for (const y of yPositionsSide) {
    for (const z of zPositions) {
      rightHoles.push(rightPrism.translate(width / 2 + 1, y, z));
    }
  }

  // Front side (y = +depth/2)
  const frontHoles: Manifold[] = [];
  for (const x of xPositionsFront) {
    for (const z of zPositions) {
      frontHoles.push(frontPrism.translate(x, depth / 2 + 1, z));
    }
  }

  // Bottom face (z = 0 .. bottom). Extrude along Z through the bottom thickness
  // const bottomHoles: Manifold[] = [];
  // for (const x of xPositionsBottom) {
  //   for (const y of yPositionsBottom) {
  //     bottomHoles.push(bottomPrism.translate(x, y, 0));
  //   }
  // }
  
  // Replace grid with a single large cutout inset by 5mm from inner walls, plus a central rib for stability
  let bottomUnion: Manifold | undefined = undefined;
  const BOTTOM_MARGIN = 5; // mm inset from inner walls
  const RIB_WIDTH = 8; // mm width of central stability rib
  const innerRadiusForBottom = Math.max(0, radius - wall);
  const holeWidth = Math.max(0, width - 2 * (wall + BOTTOM_MARGIN));
  const holeDepth = Math.max(0, depth - 2 * (wall + BOTTOM_MARGIN));
  if (holeWidth > 0 && holeDepth > 0) {
    const bottom2D = await roundedRectangle(
      [holeWidth, holeDepth],
      Math.max(0, innerRadiusForBottom - BOTTOM_MARGIN),
    );
    const fullBottomHole = bottom2D.extrude(bottom + 0.8);

    const rib2D = new manifold.CrossSection([
      [-RIB_WIDTH / 2, -holeDepth / 2],
      [RIB_WIDTH / 2, -holeDepth / 2],
      [RIB_WIDTH / 2, holeDepth / 2],
      [-RIB_WIDTH / 2, holeDepth / 2],
    ]);
    const ribPrism = rib2D.extrude(bottom + 0.8);

    bottomUnion = fullBottomHole.subtract(ribPrism);
  }

  const leftUnion = unionAll(leftHoles);
  const rightUnion = unionAll(rightHoles);
  const frontUnion = unionAll(frontHoles);
  const unions = [leftUnion, rightUnion, frontUnion, bottomUnion].filter(
    (m): m is Manifold => m !== undefined,
  );
  if (unions.length === 0) {
    // Return an empty solid by subtracting a translated version of itself; but easier: a zero-sized union is not supported.
    // Fallback: create a tiny degenerate that won't affect subtraction; return a very small prism outside the model bounds.
    return bottomPrism.translate(0, 0, -99999);
  }
  const allHoles = unions.reduce((acc, cur) => acc.add(cur));
  return allHoles;
}

// The box (without clips) with origin in the middle of the bottom face
export async function base(
  height: number,
  width: number,
  depth: number,
  radius: number,
  wall: number,
  bottom: number,
): Promise<Manifold> {
  const innerRadius = Math.max(0, radius - wall);
  const outer = (await roundedRectangle([width, depth], radius)).extrude(
    height,
  );
  const innerNeg = (
    await roundedRectangle([width - 2 * wall, depth - 2 * wall], innerRadius)
  )
    .extrude(height - bottom)
    .translate([0, 0, bottom]);

  // Start with the basic box
  let result = outer.subtract(innerNeg);
  
  // Try to add vent holes, but don't fail if it doesn't work
  try {
    const holeUnion = await createVentHoles(height, width, depth, wall, bottom, radius);
    result = result.subtract(holeUnion);
    console.log("Vent holes subtracted successfully (single union)");
  } catch (error) {
    console.warn("Failed to create vent holes:", error);
    // Continue without vent holes if there's an error
  }

  return result;
}

// The box (with clips), with origin where clips meet the box
export async function box(
  height: number,
  width: number,
  depth: number,
  radius: number,
  wall: number,
  bottom: number,
): Promise<Manifold> {
  const padding = 5; /* mm */
  const W = width - 2 * radius - 2 * padding; // Working area
  const gw = 40; // (horizontal) gap between clip origins
  const N = Math.floor(W / gw + 1); // How many (pairs of) clips we can fit
  const M = N - 1;
  const dx = ((-1 * M) / 2) * gw; // where to place the clips

  // Same as horizontal, but vertically (slightly simpler because we always start
  // from 0 and we don't need to take the radius into account)
  const H = height - CLIP_HEIGHT; // Total height minus clip height
  const gh = 40;
  const NV = Math.floor(H / gh + 1);

  let res = await base(height, width, depth, radius, wall, bottom);

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < NV; j++) {
      // For all but the first level, chamfer the clips
      const chamfer = j > 0;
      const [clipL, clipR] = await clips(chamfer);
      res = res.add(clipL.translate(i * gw + dx, -depth / 2, j * gh));
      res = res.add(clipR.translate(i * gw + dx, -depth / 2, j * gh));
    }
  }

  return res;
}
