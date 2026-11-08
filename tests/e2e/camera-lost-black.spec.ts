/** A black picture (DoD SYN-05). The case is in camera-cases.ts; the clip is a launch option, so it has a file of its own. */
import { test } from '@playwright/test';
import { fakeCamera } from './camera-helpers';
import { registerLostBlack } from './camera-cases';

test.use({ ...fakeCamera('black'), viewport: { width: 1366, height: 768 } });
registerLostBlack();
