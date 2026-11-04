import { DemoApi } from './demo';
import { HttpApi } from './http';
import type { Api } from './types';

declare const __DEMO__: boolean;

export const api: Api = __DEMO__ ? new DemoApi() : new HttpApi(import.meta.env.VITE_API_URL ?? '');
export * from './types';
