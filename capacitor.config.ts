import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.vande.cricket',
  appName: 'VANDE Cricket',
  // CAP_WEB_DIR lets a local device build sync its own bundle (e.g. dist-android) without touching the e2e dist/.
  webDir: process.env.CAP_WEB_DIR || 'dist',
  android: {
    // Off in every build; CAP_LOCAL_HTTP=1 at `cap sync` lets a debug build call the local http API (device testing).
    allowMixedContent: process.env.CAP_LOCAL_HTTP === '1',
    backgroundColor: '#06051f',
    // Off in every build; CAP_WEBVIEW_DEBUG=1 at `cap sync` enables it for local device automation only.
    webContentsDebuggingEnabled: process.env.CAP_WEBVIEW_DEBUG === '1',
  },
  plugins: {
    // The app is always dark: light status and navigation bar icons whatever the device theme (Capacitor 8 core).
    SystemBars: {
      style: 'DARK',
    },
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#06051f',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#06051f',
      overlaysWebView: false,
    },
  },
};

export default config;
