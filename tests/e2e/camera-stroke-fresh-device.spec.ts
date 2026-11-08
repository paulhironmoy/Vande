/** Choosing Camera on a fresh device, then batting (DoD SYN-05). The case is in camera-cases.ts; the clip is a launch option, so it has a file of its own. */
import { test } from '@playwright/test';
import { fakeCamera } from './camera-helpers';
import { registerFresh } from './camera-cases';

test.use({ ...fakeCamera('rh_drive'), viewport: { width: 1366, height: 768 } });
registerFresh();
