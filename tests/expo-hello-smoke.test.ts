import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROUTES } from '../apps/expo-hello/routes';
import {
  INITIAL_MESSAGE_RECEIPT_ROWS,
  INITIAL_TRAVELER_ROWS,
  TRIP_IMAGE_COUNT,
  createInitialExpoHelloState,
  evaluateExpoHelloModel,
} from '../apps/expo-hello/trips';
import { describe, expect, it } from 'vitest';

type PackageManifest = {
  readonly dependencies?: Record<string, string>;
  readonly main?: string;
  readonly scripts?: Record<string, string>;
};

type ExpoConfig = {
  readonly expo?: {
    readonly icon?: string;
    readonly web?: {
      readonly favicon?: string;
    };
  };
};

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appRoot = path.join(repoRoot, 'apps/expo-hello');

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function appPath(relativePath: string): string {
  return path.join(appRoot, relativePath);
}

describe('Expo hello smoke', () => {
  it('declares the four navigation example routes', () => {
    expect(APP_ROUTES).toEqual([
      { id: 'home-screen', title: 'Home Screen' },
      { id: 'message', title: 'Message' },
      { id: 'add-or-edit-trip', title: 'Add or Edit Trip' },
      { id: 'current-message', title: 'Current Message' },
    ]);
  });

  it('seeds home screen trips with members and separate receipt status data', async () => {
    const state = createInitialExpoHelloState();
    const { trips } = await evaluateExpoHelloModel(state);

    expect(TRIP_IMAGE_COUNT).toBe(3);
    expect(state.trips.every((trip) => trip.imageUri.startsWith('data:image/svg+xml;utf8,'))).toBe(true);
    expect(trips.map((trip) => ({
      id: trip.id,
      latestMessage: trip.latestMessage,
      memberCount: trip.travelers.length,
      name: trip.name,
    }))).toEqual([
      {
        id: 'queenstown',
        latestMessage: 'Accommodation shortlist is ready.',
        memberCount: 4,
        name: 'Queenstown planning trip',
      },
      {
        id: 'wellington',
        latestMessage: 'Dinner booking confirmed for Friday.',
        memberCount: 2,
        name: 'Wellington weekend',
      },
      {
        id: 'rotorua',
        latestMessage: 'Bring rain jackets and walking shoes.',
        memberCount: 3,
        name: 'Rotorua family visit',
      },
    ]);
    expect(INITIAL_TRAVELER_ROWS.filter((traveler) => traveler.tripId === 'queenstown').map((traveler) => traveler.name)).toEqual([
      'Mia',
      'Noah',
      'Ava',
      'Leo',
    ]);
    expect(INITIAL_TRAVELER_ROWS.some((traveler) => 'status' in traveler)).toBe(false);
    expect(INITIAL_MESSAGE_RECEIPT_ROWS.filter((receipt) => receipt.tripId === 'queenstown').map((receipt) => receipt.status)).toEqual([
      'confirmed',
      'seen',
      'pending',
      'pending',
    ]);
  });

  it('keeps the web build wired into the workspace', () => {
    const manifest = readJson<PackageManifest>(appPath('package.json'));

    expect(manifest.main).toBe('index.ts');
    expect(manifest.scripts).toMatchObject({
      build: 'expo export --platform web --output-dir dist',
      dev: 'expo start',
      test: 'pnpm run typecheck',
      typecheck: 'tsc --noEmit',
      web: 'expo start --web',
    });
    expect(manifest.dependencies).toMatchObject({
      '@tarstate/core': 'github:neftaly/tarstate#9b664a8421ffbd18c94a2766a25b3581a4129c33&path:/packages/core',
      expo: '~56.0.12',
      react: '19.2.3',
      'react-dom': '19.2.3',
      'react-native': '0.85.3',
      'react-native-web': '~0.21.2',
    });
  });

  it('keeps the Expo web entry assets present and generated output ignored', () => {
    const config = readJson<ExpoConfig>(appPath('app.json'));
    const gitignore = readFileSync(appPath('.gitignore'), 'utf8');

    expect(config.expo?.icon).toBe('./assets/icon.png');
    expect(config.expo?.web?.favicon).toBe('./assets/favicon.png');
    expect(existsSync(appPath('index.ts'))).toBe(true);
    expect(existsSync(appPath('App.tsx'))).toBe(true);
    expect(existsSync(appPath('assets/icon.png'))).toBe(true);
    expect(existsSync(appPath('assets/favicon.png'))).toBe(true);
    expect(gitignore.split('\n')).toContain('dist/');
  });

  it('keeps state management separated from the app view', () => {
    const appSource = readFileSync(appPath('App.tsx'), 'utf8');

    expect(existsSync(appPath('app-state.ts'))).toBe(true);
    expect(existsSync(appPath('screens.tsx'))).toBe(true);
    expect(existsSync(appPath('components.tsx'))).toBe(true);
    expect(existsSync(appPath('styles.ts'))).toBe(true);
    expect(appSource).toContain('useExpoHelloState');
    expect(appSource).not.toContain('applyWrites');
    expect(appSource).not.toContain('createInitialExpoHelloState');
    expect(appSource).not.toContain('StyleSheet.create');
    expect(appSource).not.toContain('function HomeScreen');
    expect(appSource).not.toContain('function MessageScreen');
  });
});
