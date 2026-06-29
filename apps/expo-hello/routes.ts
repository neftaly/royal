export type AppRouteId = 'home-screen' | 'message' | 'add-or-edit-trip' | 'current-message';

export type AppRoute = {
  readonly id: AppRouteId;
  readonly title: string;
};

export const APP_ROUTES: readonly AppRoute[] = [
  { id: 'home-screen', title: 'Home Screen' },
  { id: 'message', title: 'Message' },
  { id: 'add-or-edit-trip', title: 'Add or Edit Trip' },
  { id: 'current-message', title: 'Current Message' },
];
