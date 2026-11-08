/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;
declare const __BUILD_DATE__: string;
/** True only in an Android web bundle explicitly built for the opt-in, reviewed Unity export. */
declare const __UNITY_PRACTICE_ENABLED__: boolean;

interface ImportMetaEnv {
  /** Engineering-only inspection; effective only when that platform's Unity build flag is also true. */
  readonly VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
/** True only in an explicitly requested Unity WebGL engineering-preview bundle. */
declare const __UNITY_PRACTICE_WEB_ENABLED__: boolean;
