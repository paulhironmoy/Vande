import { Capacitor } from '@capacitor/core';

/** Save a text file: native share sheet on Android, download on the web. Returns how it was delivered. */
export async function saveTextFile(name: string, text: string, mime = 'application/json'): Promise<'shared' | 'downloaded' | 'clipboard'> {
  if (Capacitor.isNativePlatform()) {
    try {
      const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
      const res = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: name, url: res.uri, dialogTitle: 'Save your VANDE progress' });
      return 'shared';
    } catch {
      /* fall through to the web path */
    }
  }
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'downloaded';
  } catch {
    await navigator.clipboard?.writeText(text);
    return 'clipboard';
  }
}
