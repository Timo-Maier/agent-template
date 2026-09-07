// test/setup.js
// Global Vitest setup — silences pino logger and suppresses console.error
// during intentional error-path tests so CI output stays clean.
/* global beforeEach, afterEach, vi */

process.env.LOG_LEVEL = 'silent';

let consoleErrorSpy;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});
