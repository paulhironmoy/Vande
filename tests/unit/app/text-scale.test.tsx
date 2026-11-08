import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@/app/storeTypes';
import { useApp } from '@/app/store';
import { SettingsPanel } from '@/screens/settings/SettingsPanel';
import { PracticeSettings } from '@/practice/ui/screens/PracticeSettings';

vi.mock('@/i18n', () => ({
  LOCALES: [{ id: 'en', htmlLang: 'en', nativeName: 'English', englishName: 'English', status: 'complete' }],
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('@/i18n/practice', () => ({
  usePracticeT: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values?.pct ? `${String(values.pct)}%` : key),
    tk: (key: string) => key,
  }),
}));

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ settings: { ...DEFAULT_SETTINGS } });
});

afterEach(cleanup);

describe('production 200% text-size choice', () => {
  it('is selectable in the shared web/native settings panel', () => {
    render(<SettingsPanel />);
    const choice = screen.getByTestId('settings-text-size-2');
    expect(choice.textContent).toContain('200%');
    fireEvent.click(choice);
    expect(useApp.getState().settings.textScale).toBe(2);
    expect(JSON.parse(localStorage.getItem('vc:settings') ?? '{}')).toMatchObject({ textScale: 2 });
  });

  it('is selectable from the native Practice settings surface', () => {
    render(
      <PracticeSettings
        assessment={null}
        inningsInProgress={false}
        audio={null}
        onChanged={vi.fn()}
        onCleared={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const choice = screen.getByTestId('practice-settings-text-2');
    expect(choice.textContent).toContain('200%');
    fireEvent.click(choice);
    expect(useApp.getState().settings.textScale).toBe(2);
  });
});
