import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * Thin client for the real API using an authenticated Playwright request context.
 * Adds the CSRF header (value of the readable `ori_csrf` cookie) to unsafe methods.
 */
export class Api {
  constructor(readonly request: APIRequestContext) {}

  async csrf(): Promise<string> {
    const state = await this.request.storageState();
    const c = state.cookies.find((x) => x.name === 'ori_csrf');
    return c?.value ?? '';
  }

  private async headers(): Promise<Record<string, string>> {
    return { 'X-CSRF-Token': await this.csrf() };
  }

  get(path: string): Promise<APIResponse> {
    return this.request.get(path);
  }
  async post(path: string, data?: unknown): Promise<APIResponse> {
    return this.request.post(path, { data: data ?? {}, headers: await this.headers() });
  }
  async put(path: string, data?: unknown): Promise<APIResponse> {
    return this.request.put(path, { data: data ?? {}, headers: await this.headers() });
  }
  async patch(path: string, data?: unknown): Promise<APIResponse> {
    return this.request.patch(path, { data: data ?? {}, headers: await this.headers() });
  }
  async del(path: string): Promise<APIResponse> {
    return this.request.delete(path, { headers: await this.headers() });
  }

  /** POST and return parsed JSON, failing loudly with the response body on a non-2xx status. */
  async json<T = any>(res: APIResponse): Promise<T> {
    if (!res.ok()) throw new Error(`API ${res.url()} -> ${res.status()}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async search(category: 'flight' | 'hotel' | 'car' | 'activity', body: Record<string, unknown>) {
    return this.json(await this.post(`/api/search/${category}`, body));
  }
}
