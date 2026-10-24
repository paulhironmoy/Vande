import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.vande.republic',
  appName: 'VANDE',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#07111F',
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#07111F',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#07111F',
      overlaysWebView: false,
    },
  },
};

export default config;
