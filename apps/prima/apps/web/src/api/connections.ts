/** Metadata-only SharePoint contract. No credentials or document content. Optional browser links are server-validated, not downloads. */
export interface SharePointIdentity { serviceId: 'sharepoint'; userId: string }
export interface SharePointStatus extends SharePointIdentity {
  status: 'NotConfigured' | 'ConfiguredNotVerified';
  sites: { key: string; name: string; hasApprovedLibraries: boolean }[];
}
export interface SharePointCheck extends SharePointIdentity {
  status: 'VerifiedForCurrentUser';
  siteKey: string;
  checkedAt: string;
}
export interface SharePointLibraries extends SharePointIdentity {
  siteKey: string;
  checkedAt: string;
  libraries: { id: string; name: string }[];
  hasMore: boolean;
}
export interface SharePointItems extends SharePointIdentity {
  siteKey: string;
  driveId: string;
  checkedAt: string;
  items: { id: string; name: string; kind: 'file' | 'folder'; size: number | null; lastModifiedAt: string | null; webUrl?: string }[];
  hasMore: boolean;
}
export interface ConnectionsClient {
  sharePointRequestPreview(url: string, signal?: AbortSignal): Promise<ConnectionRequestPreview>;
  sharePointRequest(url: string, requestId: string, expectedUserId: string, signal?: AbortSignal): Promise<ConnectionRequestReceipt>;
  sharePointRequests(signal?: AbortSignal): Promise<SharePointIdentity & { requests: Omit<ConnectionRequestReceipt, 'serviceId' | 'userId'>[] }>;

  sharePointStatus(signal?: AbortSignal): Promise<SharePointStatus>;
  sharePointCheck(siteKey: string, signal?: AbortSignal): Promise<SharePointCheck>;
  sharePointLibraries(siteKey: string, signal?: AbortSignal): Promise<SharePointLibraries>;
  sharePointItems(siteKey: string, libraryId: string, signal?: AbortSignal): Promise<SharePointItems>;
}

export interface ConnectionRequestReceipt extends SharePointIdentity { requestId: string; id: string; reference: string; status: string; at: string }
export interface ConnectionRequestPreview extends SharePointIdentity { canonicalUrl: string; host: string; kind: 'site' | 'library'; status: 'RequestPreview' }
