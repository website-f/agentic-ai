import { DemoApi } from './demo';
import { HttpApi } from './http';
import type { Api } from './types';
import { DemoGuardPhone, HttpGuardPhone, type GuardPhoneClient } from './guard-phone';

declare const __DEMO__: boolean;

// P66: inside the Agentic Office (VITE_OFFICE), the office signs each call for the person signed in.
export const api: Api = __DEMO__ ? new DemoApi() : new HttpApi(import.meta.env.VITE_API_URL ?? '', import.meta.env.VITE_OFFICE === 'true');
/** The guard's own phone: its own enrolment and sign-in, apart from the office sign-in (third audit item 2). */
export const guardPhone: GuardPhoneClient = __DEMO__ ? new DemoGuardPhone((api as DemoApi).guardHost()) : new HttpGuardPhone(import.meta.env.VITE_API_URL ?? '');
export type { GuardPhoneClient } from './guard-phone';
export * from './types';
