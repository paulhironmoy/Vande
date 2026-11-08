/** Build-time values of the camera pack (vite.config.ts `define`, scripts/camera/pack.mjs). */
declare const __CAMERA_PACK__: import('./pack').CameraPackInfo | null;
/** The pack is packaged inside this build (the owner's sideload build): same-origin files, no download, no copy. */
declare const __CAMERA_BUNDLED__: boolean;
/** Where a store build downloads the pack from (empty: the app's own origin). */
declare const __CAMERA_BASE_URL__: string;
