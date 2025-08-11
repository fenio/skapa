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

// Create vent holes on the sides of the box
async function createVentHoles(
  height: number,
  width: number,
  depth: number,
  wall: number,
  bottom: number,
): Promise<Manifold[]> {
  const { Manifold } = await ManifoldModule.get();
  
  const ventHoles: Manifold[] = [];
  const holeRadius = 2; // 4mm diameter holes
  const holeSpacing = 12; // 12mm between hole centers
  const marginFromEdge = 8; // 8mm from edges
  
  // Calculate how many holes we can fit on each side
  const availableHeight = height - bottom - 2 * marginFromEdge;
  const availableWidth = width - 2 * marginFromEdge;
  const availableDepth = depth - 2 * marginFromEdge;
  
  const holesPerHeight = Math.floor(availableHeight / holeSpacing);
  const holesPerWidth = Math.floor(availableWidth / holeSpacing);
  const holesPerDepth = Math.floor(availableDepth / holeSpacing);
  
  // Create holes on the left and right sides (X faces)
  for (let h = 0; h < holesPerHeight; h++) {
    for (let d = 0; d < holesPerDepth; d++) {
      const y = -depth / 2 + marginFromEdge + d * holeSpacing;
      const z = bottom + marginFromEdge + h * holeSpacing;
      
      // Left side hole
      const leftHole = new Manifold()
        .cylinder(holeRadius, wall + 1, 0, 0)
        .rotate(90, 0, 0)
        .translate(-width / 2 - 0.5, y, z);
      ventHoles.push(leftHole);
      
      // Right side hole
      const rightHole = new Manifold()
        .cylinder(holeRadius, wall + 1, 0, 0)
        .rotate(90, 0, 0)
        .translate(width / 2 + 0.5, y, z);
      ventHoles.push(rightHole);
    }
  }
  
  // Create holes on the front and back sides (Y faces)
  for (let h = 0; h < holesPerHeight; h++) {
    for (let w = 0; w < holesPerWidth; w++) {
      const x = -width / 2 + marginFromEdge + w * holeSpacing;
      const z = bottom + marginFromEdge + h * holeSpacing;
      
      // Front side hole
      const frontHole = new Manifold()
        .cylinder(holeRadius, wall + 1, 0, 0)
        .rotate(0, 90, 0)
        .translate(x, -depth / 2 - 0.5, z);
      ventHoles.push(frontHole);
      
      // Back side hole
      const backHole = new Manifold()
        .cylinder(holeRadius, wall + 1, 0, 0)
        .rotate(0, 90, 0)
        .translate(x, depth / 2 + 0.5, z);
      ventHoles.push(backHole);
    }
  }
  
  return ventHoles;
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

  // Create vent holes
  const ventHoles = await createVentHoles(height, width, depth, wall, bottom);
  
  // Start with the basic box
  let result = outer.subtract(innerNeg);
  
  // Subtract all vent holes
  for (const hole of ventHoles) {
    result = result.subtract(hole);
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
