import type { AttendanceFlag } from '@prima/core';
import type { ShiftView } from '@prima/core';
import type { Tone } from '../ui';

export const SHIFT_STATE: Record<ShiftView['state'], { label: string; tone: Tone }> = {
  upcoming: { label: 'Later', tone: 'neutral' },
  awaiting: { label: 'Starting', tone: 'info' },
  on_duty: { label: 'On duty', tone: 'ok' },
  late_on_duty: { label: 'On duty, late', tone: 'warn' },
  no_show: { label: 'No-show', tone: 'crit' },
  done: { label: 'Finished', tone: 'neutral' },
  unfilled: { label: 'Unfilled', tone: 'crit' },
};

export const FLAG_LABEL: Record<AttendanceFlag, string> = {
  LATE: 'Late',
  OUTSIDE_GEOFENCE: 'Away from site',
  NO_PHOTO: 'No face picture',
  OFFLINE_SYNC: 'Sent later (offline)',
  EARLY_LEAVE: 'Left early',
  NO_SHOW: 'No-show',
  NOT_ROSTERED: 'Not on roster',
  FACE_NOT_MATCHED: 'Face not matched',
  NO_LIVENESS: 'Live check failed',
  NO_FACE_ENROLMENT: 'Face not enrolled',
};

export const FLAG_TONE: Record<AttendanceFlag, Tone> = {
  LATE: 'warn',
  OUTSIDE_GEOFENCE: 'crit',
  NO_PHOTO: 'warn',
  OFFLINE_SYNC: 'neutral',
  EARLY_LEAVE: 'warn',
  NO_SHOW: 'crit',
  NOT_ROSTERED: 'crit',
  FACE_NOT_MATCHED: 'crit',
  NO_LIVENESS: 'crit',
  NO_FACE_ENROLMENT: 'warn',
};
