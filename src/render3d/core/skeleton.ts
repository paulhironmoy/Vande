/**
 * The shared humanoid skeleton (19 bones) used by every player. Rest pose: standing, arms hanging, facing +Z,
 * character's left = +X. Rotations are Euler degrees, order XYZ, relative to the rest pose:
 *   limbs pointing down: X < 0 swings forward, X > 0 backward; Z > 0 moves towards the character's left (+X)
 *   spine, neck, head (pointing up): X > 0 leans forward, Y > 0 turns left, Z > 0 bends to the right
 *   shins: X > 0 bends the knee; forearms: X < 0 bends the elbow
 */
export const BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upperArmL',
  'forearmL',
  'handL',
  'upperArmR',
  'forearmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export interface BoneDef {
  name: BoneName;
  parent: BoneName | null;
  /** Offset from the parent joint at rest, metres (before body scaling). */
  offset: [number, number, number];
}

export const HIP_HEIGHT = 0.98;

export const SKELETON: readonly BoneDef[] = [
  { name: 'hips', parent: null, offset: [0, HIP_HEIGHT, 0] },
  { name: 'spine', parent: 'hips', offset: [0, 0.11, 0] },
  { name: 'chest', parent: 'spine', offset: [0, 0.2, 0] },
  { name: 'neck', parent: 'chest', offset: [0, 0.235, 0] },
  { name: 'head', parent: 'neck', offset: [0, 0.085, 0.012] },
  { name: 'upperArmL', parent: 'chest', offset: [0.205, 0.182, -0.012] },
  { name: 'forearmL', parent: 'upperArmL', offset: [0, -0.285, 0] },
  { name: 'handL', parent: 'forearmL', offset: [0, -0.255, 0] },
  { name: 'upperArmR', parent: 'chest', offset: [-0.205, 0.182, -0.012] },
  { name: 'forearmR', parent: 'upperArmR', offset: [0, -0.285, 0] },
  { name: 'handR', parent: 'forearmR', offset: [0, -0.255, 0] },
  { name: 'thighL', parent: 'hips', offset: [0.095, -0.065, 0] },
  { name: 'shinL', parent: 'thighL', offset: [0, -0.43, 0] },
  { name: 'footL', parent: 'shinL', offset: [0, -0.42, 0] },
  { name: 'thighR', parent: 'hips', offset: [-0.095, -0.065, 0] },
  { name: 'shinR', parent: 'thighR', offset: [0, -0.43, 0] },
  { name: 'footR', parent: 'shinR', offset: [0, -0.42, 0] },
];

export const BONE_INDEX: Record<BoneName, number> = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

export type Euler = readonly [number, number, number];
export type Pose = Partial<Record<BoneName, Euler>>;
