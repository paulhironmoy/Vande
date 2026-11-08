/**
 * Parity fixture for Unity's C# port of the physics batter body (ProductionBatterBodyModel.cs, a port of
 * src/physics/bat.ts batterBody). For every golden practice-v3 delivery flight and every played footwork (null = the
 * stance / a leave), the frozen physics body is written to tests/fixtures/unity-practice/batter-body-v1.json; Unity's
 * EditMode test asserts its port equals it within 1 mm. Regenerate with VANDE_WRITE_BATTER_BODY=1 (only when the
 * physics freeze changes).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unpackUnityPracticePacket, type UnityPracticePacket } from '@/contracts/unityPractice';
import { batterBody } from '@/physics/bat';
import fixtureJson from '../../../fixtures/unity-practice/practice-v3.json';

const OUT = resolve(__dirname, '../../../fixtures/unity-practice/batter-body-v1.json');
const FOOTWORKS = [null, 'forward', 'back', 'across', 'down_track'] as const;

interface FixtureCase {
  id: string;
  wire: { packets: { delivery: UnityPracticePacket } };
}

describe('Unity batter body parity fixture', () => {
  it('equals the frozen physics batterBody for every golden flight and footwork', async () => {
    const cases: unknown[] = [];
    for (const item of (fixtureJson as unknown as { cases: FixtureCase[] }).cases) {
      const delivery = await unpackUnityPracticePacket(item.wire.packets.delivery);
      if (delivery.type !== 'host.delivery') throw new Error(`delivery packet expected for ${item.id}`);
      for (const footwork of FOOTWORKS) {
        const body = batterBody(footwork, delivery.payload.flight);
        cases.push({
          id: item.id,
          footwork,
          stance: body.stance,
          pads: body.pads.map((pad) => ({ a: pad.a, b: pad.b, r: pad.r })),
          torso: body.torso,
          head: body.head,
        });
      }
    }
    const doc = {
      fixtureVersion: 1,
      source: 'src/physics/bat.ts batterBody on the frozen physics; flights from practice-v3.json delivery packets',
      cases,
    };
    if (process.env.VANDE_WRITE_BATTER_BODY === '1') writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`);
    const written = JSON.parse(readFileSync(OUT, 'utf8')) as unknown;
    expect(written).toEqual(JSON.parse(JSON.stringify(doc)) as unknown);
  });
});
