import type { ComponentType } from 'react';
export type ServiceId = 'mail' | 'sharepoint' | 'powerbi';
export type PanelCapability = 'readMetadata' | 'composeSend' | 'viewReport' | 'embedReport';
export type Capability = 'checkAccess' | PanelCapability;
export interface ResourceSelection { resourceKey: string; childKey?: string }
export interface Evidence { serviceId: ServiceId; userId: string; selection: ResourceSelection; checkedAt: string; kind: 'AccessVerified' }
export interface ConfigurationView {
  serviceId: ServiceId; userId: string; configuration: 'NotConfigured' | 'ConfiguredNotVerified';
  resources: ReadonlyArray<{ resourceKey: string; label: string }>;
  capabilities: ReadonlyArray<Capability>;
  reason?: 'ModuleAbsent' | 'ConfigurationMissing' | 'NoApprovedResources';
}
/** Panels must not fetch on mount. All reads are explicit, bounded and independently server-authorized. */
export interface ProviderPanelProps {
  userId: string; selection: ResourceSelection; evidence: Evidence | null;
  epoch: number; signal: AbortSignal; cancel: () => void; fail: () => void;
}
export interface Adapter {
  readonly serviceId: ServiceId;
  getConfiguration(signal: AbortSignal): Promise<ConfigurationView>;
  checkAccess(selection: ResourceSelection, signal: AbortSignal): Promise<Evidence>;
  /** Must match the panel's reviewed action intent; never label Send as metadata. */
  readonly panelCapability?: PanelCapability;
  readonly ProviderPanel?: ComponentType<ProviderPanelProps>;
}
