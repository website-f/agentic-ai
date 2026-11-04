import type { Adapter, ServiceId } from './contract';
export const serviceIds: readonly ServiceId[] = ['mail', 'sharepoint', 'powerbi'];
/** Explicit, static module registration. Absence is never inferred from an HTTP failure. */
export function createRegistry(adapters: readonly Adapter[]): ReadonlyMap<ServiceId, Adapter> {
  const registry = new Map<ServiceId, Adapter>();
  for (const adapter of adapters) {
    if (!serviceIds.includes(adapter.serviceId) || registry.has(adapter.serviceId)) throw new Error('Invalid Connections registration.');
    registry.set(adapter.serviceId, adapter);
  }
  return registry;
}
