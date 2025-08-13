# Vent Holes Improvements for SKAPA

## Overview
This document describes the improvements made to the vent hole system in the SKAPA 3D printable model generator for IKEA SKÅDIS pegboards.

## Key Improvements

### 1. **Consistent Vent Hole Design**
- **Before**: Vent holes were only on left, right, and front sides with inconsistent sizing
- **After**: All vent holes now use consistent sizing and spacing across all sides for uniform appearance
- **Benefit**: Eliminates the need to avoid tilting during 3D printing, as all holes have the same orientation and size

### 2. **Bottom Side Vent Holes Added**
- **Before**: No vent holes on the bottom side
- **After**: Added rectangular vent holes on the bottom side in a grid pattern
- **Benefit**: Improved airflow and ventilation from all directions

### 3. **Back Side Protection**
- **Before**: Back side was already protected (no clips or holes)
- **After**: Maintained protection of back side - no clips or vent holes added
- **Benefit**: Preserves the back side for connectors and mounting hardware

## Technical Implementation

### Vent Hole Geometry
- **Side holes**: 45-degree tilted rectangular holes for better airflow direction
- **Bottom holes**: Simple rectangular holes (no tilt needed for bottom surface)
- **Consistent sizing**: All holes use the same width and spacing parameters
- **Dynamic scaling**: Hole size and spacing automatically adjust based on box dimensions

### Manifold Library Usage
The implementation leverages the Manifold 3D library for:
- **CrossSection creation**: Defines hole shapes using 2D cross-sections
- **Extrusion**: Creates 3D holes by extruding cross-sections
- **Boolean operations**: Subtracts holes from the main box geometry
- **Transformations**: Rotates and translates holes to correct positions

### Key Functions
- `createVentHoles()`: Main function that generates all vent holes
- `calculateOptimalSize()`: Determines optimal hole size and spacing based on available space
- Consistent parameters across all sides for uniform appearance

## Benefits for 3D Printing

1. **No Tilt Avoidance**: Consistent hole design means no need to avoid tilting during printing
2. **Better Ventilation**: Holes on all sides (except back) provide comprehensive airflow
3. **Uniform Appearance**: Consistent sizing creates a professional, uniform look
4. **Scalable Design**: Automatically adapts to different box sizes while maintaining proportions

## File Changes
- `src/model/manifold.ts`: Updated vent hole creation logic
- `src/main.ts`: Removed unused import

## Testing
The implementation has been tested for:
- TypeScript compilation errors (none found)
- Development server startup (successful)
- Vent hole generation across different box sizes