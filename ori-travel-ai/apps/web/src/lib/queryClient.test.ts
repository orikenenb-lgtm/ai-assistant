import { ApiError } from './api';
import { shouldRetry } from './queryClient';

const err = (status: number, code = 'X') => new ApiError({ status, code, message: 'm' });

describe('shouldRetry', () => {
  it('never retries 4xx', () => {
    expect(shouldRetry(0, err(400))).toBe(false);
    expect(shouldRetry(0, err(401))).toBe(false);
    expect(shouldRetry(0, err(404))).toBe(false);
    expect(shouldRetry(0, err(429))).toBe(false);
  });
  it('retries network errors and 5xx a limited number of times', () => {
    expect(shouldRetry(0, err(0, 'NETWORK_ERROR'))).toBe(true);
    expect(shouldRetry(1, err(503))).toBe(true);
    expect(shouldRetry(2, err(503))).toBe(false);
  });
  it('does not retry invalid responses', () => {
    expect(shouldRetry(0, err(200, 'INVALID_RESPONSE'))).toBe(false);
  });
});
