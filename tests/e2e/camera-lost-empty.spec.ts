/** Nobody in the picture (DoD SYN-05). The case is in camera-cases.ts; the clip is a launch option, so it has a file of its own. */
import { test } from '@playwright/test';
import { fakeCamera } from './camera-helpers';
import { registerLostEmpty } from './camera-cases';

test.use({ ...fakeCamera('empty_room'), viewport: { width: 1366, height: 768 } });
registerLostEmpty();
