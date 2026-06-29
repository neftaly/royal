import { APP_ROUTES, type AppRouteId } from './routes';
import type { ReceptionStatus } from './trips';

export const MESSAGE_LIMIT = 200;

export function routeTitle(routeId: AppRouteId): string {
  return APP_ROUTES.find((route) => route.id === routeId)?.title ?? routeId;
}

export function statusLabel(status: ReceptionStatus): string {
  if (status === 'confirmed') return 'Confirmed reception';
  if (status === 'seen') return 'Seen message';
  return 'None';
}

export function statusIcon(status: ReceptionStatus): string {
  if (status === 'confirmed') return '✓';
  if (status === 'seen') return '👁';
  return '?';
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function memberText(count: number): string {
  return count === 1 ? '1 member' : `${count} members`;
}
