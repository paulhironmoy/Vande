/**
 * Ball impact on a moving rigid surface (bat face, bat edge, gloves, pads): one impulse model for every contact.
 * Normal: restitution on the relative normal velocity with the surface's effective mass. Tangential: Coulomb
 * friction up to the impulse that stops the contact point slipping (sphere I = k m R²), which also changes the spin,
 * so incoming spin deflects the exit ("the ball squirts off the face").
 */
import { BALL_INERTIA_K, BALL_MASS, BALL_R } from './constants';
import { type Vec3, cross, dot, v3 } from './vec';

export interface ImpactInput {
  /** Ball velocity and spin (rad/s) just before contact. */
  v: Vec3;
  spin: Vec3;
  /** Unit contact normal, from the surface towards the ball centre. */
  n: Vec3;
  /** Velocity of the surface at the contact point. */
  surfaceV: Vec3;
  /** Effective mass of the surface at the contact (Infinity = immovable). */
  mass: number;
  cor: number;
  friction: number;
}

export interface ImpactOutput {
  v: Vec3;
  spin: Vec3;
  /** Normal impulse per unit ball mass (m/s). */
  jn: number;
}

export function impact(i: ImpactInput): ImpactOutput {
  const n = i.n;
  // Contact point relative to the ball centre, and its velocity.
  const rc = v3(-BALL_R * n.x, -BALL_R * n.y, -BALL_R * n.z);
  const wr = cross(i.spin, rc);
  const rel = v3(i.v.x + wr.x - i.surfaceV.x, i.v.y + wr.y - i.surfaceV.y, i.v.z + wr.z - i.surfaceV.z);
  const rn = dot(rel, n);
  if (rn >= 0) return { v: { ...i.v }, spin: { ...i.spin }, jn: 0 };
  const ratio = Number.isFinite(i.mass) ? BALL_MASS / i.mass : 0;
  const jn = (-(1 + i.cor) * rn) / (1 + ratio);
  const tx = rel.x - rn * n.x;
  const ty = rel.y - rn * n.y;
  const tz = rel.z - rn * n.z;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  let jt = 0;
  let ux = 0;
  let uy = 0;
  let uz = 0;
  if (tl > 1e-9) {
    ux = tx / tl;
    uy = ty / tl;
    uz = tz / tl;
    const stick = tl / (1 + 1 / BALL_INERTIA_K + ratio);
    const cap = i.friction * jn;
    jt = stick < cap ? stick : cap;
  }
  const v = v3(i.v.x + jn * n.x - jt * ux, i.v.y + jn * n.y - jt * uy, i.v.z + jn * n.z - jt * uz);
  // Δω = r × (−jt û) / (k R²)
  const tq = cross(rc, v3(-jt * ux, -jt * uy, -jt * uz));
  const kr2 = BALL_INERTIA_K * BALL_R * BALL_R;
  const spin = v3(i.spin.x + tq.x / kr2, i.spin.y + tq.y / kr2, i.spin.z + tq.z / kr2);
  return { v, spin, jn };
}
