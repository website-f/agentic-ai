import { BadRequestException } from '@nestjs/common';
import type { DutyOfflineContext } from '@prima/core';

/** Preserve the replay binding through DTO parsing. null/partial/invalid values must not become an unbound send. */
export function dutyOfflineContext(value: unknown): DutyOfflineContext | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid offline context.');
  const input = value as Record<string, unknown>;
  const result = {} as DutyOfflineContext;
  for (const field of ['accountId', 'companyId', 'siteId', 'deviceId', 'enrollmentId'] as const) {
    const v = input[field];
    if (typeof v !== 'string' || !v.trim() || v.length > 200) throw new BadRequestException('Invalid offline context.');
    result[field] = v;
  }
  return result;
}
