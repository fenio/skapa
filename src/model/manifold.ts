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

// Create one simple rectangular hole on each side (left, right, front)
async function createVentHoles(
  height: number,
  width: number,
  depth: number,
  wall: number,
  ventHoleWidth: number,
  ventHoleHeight: number,
): Promise<Manifold[]> {
  const manifold = await ManifoldModule.get();
  
  const ventHoles: Manifold[] = [];
  
    // Create dynamic vent holes based on box size
  const marginFromEdge = 5; // 5mm from edges
  const minHoleWidth = Math.max(2, ventHoleWidth * 0.5); // Minimum hole width (50% of configured size)
  const maxHoleWidth = Math.min(12, ventHoleWidth * 1.5); // Maximum hole width (150% of configured size)
  const minSpacing = 8; // Minimum spacing between holes
  const maxSpacing = 20; // Maximum spacing between holes
  
  // Calculate available space for holes on each side
  const availableWidth = width - 2 * marginFromEdge;
  const availableDepth = depth - 2 * marginFromEdge;
  const topMargin = marginFromEdge + 5; // Margin from top edge
  const availableHeight = height - topMargin - marginFromEdge; // Available space from top down
  
  // Ensure minimum available space for holes
  const minAvailableSpace = 8; // Minimum space needed for at least one hole
  
  // Calculate optimal hole size and spacing based on available space
  const calculateOptimalSize = (availableSpace: number, minHoles: number = 1) => {
    const maxHoles = Math.max(minHoles, Math.floor(availableSpace / minSpacing));
    const optimalSpacing = Math.min(maxSpacing, Math.max(minSpacing, availableSpace / maxHoles));
    const optimalHoleSize = Math.min(maxHoleWidth, Math.max(minHoleWidth, optimalSpacing * 0.3));
    const actualHoles = Math.max(minHoles, Math.floor(availableSpace / optimalSpacing));
    
    // Ensure holes don't extend beyond the wall boundaries
    const totalHoleSpace = (actualHoles - 1) * optimalSpacing + optimalHoleSize;
    if (totalHoleSpace > availableSpace) {
      // Reduce number of holes if they don't fit
      const maxFittingHoles = Math.max(minHoles, Math.floor((availableSpace - optimalHoleSize) / optimalSpacing) + 1);
      return { holeSize: optimalHoleSize, spacing: optimalSpacing, holes: maxFittingHoles };
    }
    
    return { holeSize: optimalHoleSize, spacing: optimalSpacing, holes: actualHoles };
  };
  
  // Calculate optimal parameters for each side
  const frontParams = calculateOptimalSize(Math.max(availableWidth, minAvailableSpace), 2);
  const sideParams = calculateOptimalSize(Math.max(availableDepth, minAvailableSpace), 2);
  const heightParams = calculateOptimalSize(Math.max(availableHeight, minAvailableSpace), 2);
  
  // Use the configured vent hole sizes directly
  const holeWidth = ventHoleWidth;
  const holeHeight = ventHoleHeight;
  const holeSpacing = Math.min(frontParams.spacing, sideParams.spacing, heightParams.spacing);
  
  // Calculate 45-degree tilt offset (tan(45°) = 1, so offset = holeHeight)
  const tiltOffset = holeHeight; // This creates a true 45-degree angle
  
  // Calculate number of holes that fit in each direction
  const holesPerWidth = frontParams.holes;
  const holesPerDepth = sideParams.holes;
  const holesPerHeight = heightParams.holes;
  
  // Calculate consistent base height for all sides - position closer to top edges
  const baseHeight = height - topMargin - (holesPerHeight - 1) * holeSpacing - holeHeight; // Position from top down
  
  // Create holes on left side (depth x height grid)
  for (let i = 0; i < holesPerDepth; i++) {
    for (let j = 0; j < holesPerHeight; j++) {
      const x = -width / 2 - 1;
      const y = -depth / 2 + marginFromEdge + i * holeSpacing;
      const z = baseHeight + j * holeSpacing;
      
      // Create a 45-degree tilted rectangle cross-section for left side
      const leftHole = new manifold.CrossSection([
        [-holeWidth/2, -holeHeight/2], // Bottom left
        [holeWidth/2, -holeHeight/2], // Bottom right
        [holeWidth/2 + tiltOffset, holeHeight/2], // Top right (45° tilted)
        [-holeWidth/2 + tiltOffset, holeHeight/2] // Top left (45° tilted)
      ]).extrude(wall + 2)
        .rotate(0, 90, 0) // Rotate around Y-axis to face left
        .translate(x, y, z);
      ventHoles.push(leftHole);
    }
  }
  
  // Create holes on right side (depth x height grid)
  for (let i = 0; i < holesPerDepth; i++) {
    for (let j = 0; j < holesPerHeight; j++) {
      const x = width / 2 + 1;
      const y = -depth / 2 + marginFromEdge + i * holeSpacing;
      const z = baseHeight + j * holeSpacing;
      
      // Create a 45-degree tilted rectangle cross-section for right side (opposite tilt)
      const rightHole = new manifold.CrossSection([
        [-holeWidth/2, -holeHeight/2], // Bottom left
        [holeWidth/2, -holeHeight/2], // Bottom right
        [holeWidth/2 - tiltOffset, holeHeight/2], // Top right (45° tilted opposite)
        [-holeWidth/2 - tiltOffset, holeHeight/2] // Top left (45° tilted opposite)
      ]).extrude(wall + 2)
        .rotate(0, -90, 0) // Rotate around Y-axis to face right
        .translate(x, y, z);
      ventHoles.push(rightHole);
    }
  }
  
  // Create holes on front side (width x height grid)
  for (let i = 0; i < holesPerWidth; i++) {
    for (let j = 0; j < holesPerHeight; j++) {
      const x = -width / 2 + marginFromEdge + i * holeSpacing;
      const y = depth / 2 + 1;
      const z = baseHeight + j * holeSpacing; // Position from top down, no rotation offset needed
      
      // Create a 45-degree tilted rectangle cross-section for front side
      const frontHole = new manifold.CrossSection([
        [-holeWidth/2, -holeHeight/2], // Bottom left
        [holeWidth/2, -holeHeight/2], // Bottom right
        [holeWidth/2 + tiltOffset, holeHeight/2], // Top right (45° tilted)
        [-holeWidth/2 + tiltOffset, holeHeight/2] // Top left (45° tilted)
      ]).extrude(wall + 2)
        .rotate(90, 0, 0) // Rotate around X-axis to face front
        .translate(x, y, z);
      ventHoles.push(frontHole);
    }
  }
  
  // NO BACK SIDE HOLES - back side has connectors and should remain untouched
  
  console.log(`Created ${ventHoles.length} dynamic 45-degree slash-shaped vent holes near top edges (${holesPerWidth}x${holesPerHeight} on front, ${holesPerDepth}x${holesPerHeight} on sides) - Hole size: ${holeWidth.toFixed(1)}x${holeHeight.toFixed(1)}mm, Spacing: ${holeSpacing.toFixed(1)}mm, Top margin: ${topMargin}mm`);
  
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
  ventHoleWidth: number,
  ventHoleHeight: number,
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
    const ventHoles = await createVentHoles(height, width, depth, wall, ventHoleWidth, ventHoleHeight);
    console.log("Vent holes created:", ventHoles.length);
    
    // Subtract all vent holes
    for (const hole of ventHoles) {
      result = result.subtract(hole);
    }
    console.log("Vent holes subtracted successfully");
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
  ventHoleWidth: number,
  ventHoleHeight: number,
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

  let res = await base(height, width, depth, radius, wall, bottom, ventHoleWidth, ventHoleHeight);

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
