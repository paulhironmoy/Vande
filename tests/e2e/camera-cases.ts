/**
 * The camera end-to-end cases (DoD SYN-05), registered by the one-clip spec files `camera-stroke-*.spec.ts` and `camera-lost-*.spec.ts`.
 * Playwright forbids `test.use({ launchOptions })` inside a describe block (it forces a new worker), and the fake camera's video file
 * IS a launch option, so every clip gets a spec file of its own that calls `test.use(fakeCamera(clip))` at the top and one `register...`
 * function from here. Not a spec itself (its name does not match the Practice project).
 *
 * AUTOMATED FIXTURES, NOT PLAYER RESULTS: they prove the plumbing (permission, capture, worker, pose, mapper, tracker, the normalised
 * swing, the record), never that anyone can bat with a camera. The clip loops every 4 s and a delivery is short, so a stroke can fall
 * anywhere in a delivery: the stroke cases bat several deliveries (each waits for a steady person first) and judge the FIRST swing the
 * camera produced, never its timing.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  attachState,
  cameraState,
  driveCameraSetup,
  needVideo,
  startCameraGame,
  waitForCamera,
  type CameraHooks,
} from './camera-helpers';
import { openPractice, state, waitFor } from './practice-helpers';

type Swing = NonNullable<CameraHooks['lastSwing']>;

const CAMERA_CHOSEN = { v: 1, teach: false, demoSeen: true, control: 'camera', controlChosen: true };
const BALLS = 8;
interface Case {
  clip: string;
  hand: 'right' | 'left';
  what: string;
  /** What the first camera swing must be. */
  check: (s: Swing) => void;
}

const attack = (s: Swing) => expect(s.kind, 'an attacking swing').toBe('attack');

export const STROKES: Case[] = [
  {
    clip: 'rh_drive',
    hand: 'right',
    what: 'an attack to the off side',
    check: (s) => {
      attack(s);
      expect(s.directionDeg).toBeGreaterThan(3);
      expect(s.power).toBeGreaterThan(0.2);
    },
  },
  {
    clip: 'rh_pull',
    hand: 'right',
    what: 'an attack to the leg side',
    check: (s) => {
      attack(s);
      expect(s.directionDeg).toBeLessThan(-15);
    },
  },
  {
    clip: 'rh_loft',
    hand: 'right',
    what: 'a lofted attack, roughly straight',
    check: (s) => {
      attack(s);
      expect(Math.abs(s.directionDeg ?? 0)).toBeLessThan(25);
    },
  },
  {
    clip: 'rh_defence',
    hand: 'right',
    what: 'a defensive push',
    check: (s) => expect(s.kind, 'a defensive swing').toBe('defend'),
  },
  {
    clip: 'lh_drive',
    hand: 'left',
    what: "an attack to the left-hander's off side (the same bearing as the right-hander)",
    check: (s) => {
      attack(s);
      expect(s.directionDeg).toBeGreaterThan(3);
    },
  },
  {
    clip: 'lh_pull',
    hand: 'left',
    what: "an attack to the left-hander's leg side",
    check: (s) => {
      attack(s);
      expect(s.directionDeg).toBeLessThan(-15);
    },
  },
];

/**
 * The game's speed in the cases that need the video's stroke to fall inside a live ball (CAM-DIAG, 2026-11-08).
 *
 * The clip loops every 4.0 s. The camera is armed only from the release of a ball to the ball passing the stumps (about 1.0 s at full
 * speed and 2.0 s at timeScale 0.5 for the 80 to 90 km/h first balls of these seeds, plus 0.25 s once the backlift is seen), and one whole
 * stroke of a clip (the backlift at 1.3 s to the strike at about 2.3 s, seen by the camera 0.1 s later) needs a longer stretch of video than
 * that unless the ball goes live at the right point of the loop. Where it goes live is not random: the first ball depends on when the pose
 * engine finished starting, and at timeScale 0.5 every later ball went live 8.0 s after the one before (two whole loops, because a ball
 * waits for a steady person, which the loop offers once every 4.0 s) at the same point of the loop, six balls in a row in both failing runs.
 * A stroke that missed the first ball then missed every ball until the one-wicket innings ended: at 0.5 rh_pull passed 3 of 5 runs and
 * rh_defence found no swing in 2 of 3 (its first ball bowled the batter), while rh_loft found one every time (the longer run-up of its
 * 133 km/h first ball happened to put it at a good point of the loop). A window of one whole loop or more sees a whole stroke from every
 * start point (the model-free phase sweep in SYNTH-VIDEO/classes.json: 100% of start points at 4 s, 65% at 2.5 s, 40% at 1.5 s), so
 * these cases slow the game until the window is longer than the loop: 0.15 gives 6.5 s for the 88 km/h first ball of rh_pull and 4.5 s
 * for the 133 km/h one of rh_loft (a ball faster than about 145 km/h would need a smaller number). The class a stroke gets never
 * depends on the speed of the game: the camera judges the picture in real time.
 */
const STROKE_TIME_SCALE = 0.15;

export function registerStroke(clip: string) {
  const c = STROKES.find((s) => s.clip === clip);
  if (!c) throw new Error(`no stroke case for ${clip}`);
  test(`the first camera swing is ${c.what}`, async ({ page }, info) => {
    test.setTimeout(300_000);
    needVideo(c.clip);
    await startCameraGame(page, `e2e-camera-${c.clip}`, c.hand, { timeScale: STROKE_TIME_SCALE });
    let swing: Swing | null = null;
    let balls = 0;
    while (!swing && balls < BALLS) {
      await waitFor(page, ['live'], 120_000);
      await waitFor(page, ['dead', 'out', 'over_summary'], 120_000);
      balls++;
      swing = (await cameraState(page))?.lastSwing ?? null;
      // The one-wicket innings is over when the batter is out: no ball can follow, so stop here and let the check below say what is missing.
      if (!swing && (await state(page)).last?.dismissal) break;
    }
    await attachState(page, info, `camera-state-${c.clip}.json`);
    expect(swing, `the camera produced a swing within ${BALLS} deliveries`).not.toBeNull();
    c.check(swing as Swing);
    // The same swing is what the game scored: the delivery was batted with that kind of swing.
    const st = await state(page);
    expect(st.error).toBeNull();
    expect(['attack', 'defend']).toContain(st.last?.swing);
    const cam = await cameraState(page);
    expect(cam?.status === 'running' || cam?.status === 'lost').toBe(true);
    expect(cam?.delegate === 'CPU' || cam?.delegate === 'GPU').toBe(true);
  });
}

export function registerFresh() {
  test('Camera is chosen in the row, the consent and guide come first, then the first ball is batted with the camera', async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    needVideo('rh_drive');
    // A device that has never answered "How do you want to bat?": the row asks; Mouse is selected until the player taps Camera.
    await openPractice(
      page,
      { tier: 'below', seed: 'e2e-camera-fresh', autoNext: true, timeScale: STROKE_TIME_SCALE },
      { settings: { v: 1, teach: false, demoSeen: true, controlChosen: false } },
    );
    await page.getByTestId('practice-random').click();
    const camera = page.getByTestId('practice-control-row-camera');
    await expect(camera).toHaveAttribute('aria-pressed', 'false');
    const before = await cameraState(page);
    expect(before === null || before.status === 'idle', 'no camera is running before Camera is chosen').toBe(true);
    await camera.click();
    // The consent comes before any browser prompt; its one primary button starts the camera.
    await expect(page.getByTestId('camera-consent')).toBeVisible({ timeout: 30_000 });
    expect((await cameraState(page))?.status, 'the consent comes before any camera').not.toBe('running');
    await driveCameraSetup(page, ['camera-guide-start']);
    await waitForCamera(
      page,
      (s) => s.status === 'running' && s.readiness.ready === true,
      'a steady person in frame',
      120_000,
    );
    await page.getByTestId('camera-guide-start').click();
    await page.getByTestId('practice-play-start').click();
    let swing: Swing | null = null;
    for (let balls = 0; !swing && balls < BALLS; balls++) {
      await waitFor(page, ['live'], 120_000);
      await waitFor(page, ['dead', 'out', 'over_summary'], 120_000);
      swing = (await cameraState(page))?.lastSwing ?? null;
      // The one-wicket innings is over when the batter is out: no ball can follow.
      if (!swing && (await state(page)).last?.dismissal) break;
    }
    await attachState(page, info, 'camera-state-fresh.json');
    expect(swing, 'the first ball or a later one was batted with the camera').not.toBeNull();
    expect(swing!.kind).toBe('attack');
    expect((await state(page)).error).toBeNull();
  });
}

export function registerLeave() {
  test('a held backlift that comes back slowly is no swing: the ball is left', async ({ page }, info) => {
    test.setTimeout(300_000);
    needVideo('rh_leave');
    await startCameraGame(page, 'e2e-camera-rh_leave', 'right');
    // One delivery is enough: a ball that is left may bowl the batter (a one-wicket innings), and then there is no next ball.
    await waitFor(page, ['live'], 120_000);
    await waitFor(page, ['dead', 'out', 'over_summary'], 120_000);
    expect((await state(page)).last?.swing ?? null, 'the delivery had no swing').toBeNull();
    expect((await cameraState(page))?.lastSwing ?? null, 'the camera produced no swing from a leave').toBeNull();
    await attachState(page, info, 'camera-state-rh_leave.json');
  });
}

async function toCameraScreens(page: Page, seed: string) {
  await openPractice(page, { tier: 'below', seed, autoNext: true }, { settings: CAMERA_CHOSEN });
  await page.getByTestId('practice-random').click();
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['camera']);
}

const storedControl = (page: Page) =>
  page.evaluate(
    () => (JSON.parse(localStorage.getItem('vc:practice:settings') ?? 'null') as { control?: string } | null)?.control,
  );

export function registerLostExit() {
  test('the person leaves the picture mid-over: tracking lost, a banner with one tap to the mouse, no stall', async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    needVideo('rh_exit_mid');
    await toCameraScreens(page, 'e2e-camera-exit');
    await driveCameraSetup(page, ['camera-ready-line', 'camera-guide-start']);
    await waitForCamera(
      page,
      (s) => s.status === 'running' && s.readiness.inFrame === true,
      'a person in frame',
      120_000,
    );
    // The clip takes the person away every 6 s: the pipeline notices, and the player is offered the one tap to the mouse either
    // on the between-balls banner or on the readiness card that waits for the person to come back.
    await waitForCamera(page, (s) => s.status === 'lost', 'tracking lost after the person leaves', 60_000);
    const fallback = page.getByTestId('camera-lost-fallback').or(page.getByTestId('camera-ready-fallback')).first();
    await expect(fallback, 'a one-tap switch to the mouse is on screen').toBeVisible({ timeout: 30_000 });
    // The game goes on: a ball is bowled and finishes whatever the camera sees.
    await waitFor(page, ['live', 'playing', 'dead'], 120_000);
    expect((await state(page)).error).toBeNull();
    await attachState(page, info, 'camera-state-lost.json');
    await fallback.click();
    expect(await storedControl(page)).toBe('mouse');
    await waitFor(page, ['live', 'playing', 'dead', 'over_summary'], 120_000);
    expect((await state(page)).error).toBeNull();
  });
}

export function registerLostEmpty() {
  test('nobody in the picture: the guide waits and says so, "Bat with mouse" is one tap away', async ({ page }) => {
    test.setTimeout(180_000);
    needVideo('empty_room');
    await toCameraScreens(page, 'e2e-camera-empty');
    await driveCameraSetup(page, ['camera-guide-fallback', 'camera-ready-fallback']);
    const s = await waitForCamera(
      page,
      (c) => c.status === 'running' || c.status === 'lost',
      'the picture running',
      120_000,
    );
    expect(s.readiness.ready, 'nobody is ever ready in an empty room').not.toBe(true);
    await page.waitForTimeout(3_000);
    expect((await cameraState(page))?.readiness.ready).not.toBe(true);
    await page.getByTestId('camera-guide-fallback').or(page.getByTestId('camera-ready-fallback')).first().click();
    expect(await storedControl(page)).toBe('mouse');
    await waitFor(page, ['runup', 'live', 'playing', 'dead'], 120_000);
    expect((await state(page)).error).toBeNull();
  });
}

export function registerLostBlack() {
  test('a black picture (privacy shutter, cover, OS switch): its own help, then one tap to the mouse', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    needVideo('black');
    await toCameraScreens(page, 'e2e-camera-black');
    await driveCameraSetup(page, ['camera-trouble'], { timeoutMs: 120_000 });
    await expect(page.getByTestId('camera-trouble')).toHaveAttribute('data-case', 'black', { timeout: 60_000 });
    expect((await cameraState(page))?.problem).toBe('black');
    await page.getByTestId('camera-trouble-fallback').click();
    expect(await storedControl(page)).toBe('mouse');
  });
}

export function registerLostDim() {
  test('a very dark room: the poor-light help, then one tap to the mouse', async ({ page }, info) => {
    test.setTimeout(240_000);
    needVideo('rh_drive_dim');
    await toCameraScreens(page, 'e2e-camera-dim');
    await driveCameraSetup(page, ['camera-trouble'], { timeoutMs: 60_000 });
    // The person is in the picture but it is too dark: after a few seconds the camera says so in plain words (data-case light).
    await expect(page.getByTestId('camera-trouble')).toHaveAttribute('data-case', 'light', { timeout: 60_000 });
    await attachState(page, info, 'camera-state-dim.json');
    await page.getByTestId('camera-trouble-fallback').click();
    expect(await storedControl(page)).toBe('mouse');
  });
}
