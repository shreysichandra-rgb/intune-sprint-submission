import { test, expect, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
const generateObject = vi.hoisted(() => vi.fn());
vi.mock('@convex-dev/agent', () => ({ Agent: class { generateObject = generateObject; } }));
const modules = import.meta.glob('../convex/**/*.*s');
test('an AI exception produces a visible-safe error and no stored health content', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'noncredential-test-placeholder');
  generateObject.mockRejectedValueOnce(new Error('Provider diagnostic containing PRIVATE INPUT must never be returned'));
  const t=convexTest(schema,modules);
  const pair=await t.mutation(api.tracking.createTestPair,{});
  const result=await t.action(api.messages.send,{token:pair.A,messageId:'failure',text:'Brain fog today at 9am.'});
  expect(result.outcome).toBe('error');expect(result.message).toContain('No health record was saved from this message');expect(JSON.stringify(result)).not.toContain('PRIVATE INPUT');
  expect(generateObject).toHaveBeenCalledTimes(1);
  const view=await t.query(api.tracking.getSummary,{token:pair.A});expect(view.records).toEqual([]);expect(view.pending).toEqual([]);
  const call=generateObject.mock.calls[0];expect(call[2].maxOutputTokens).toBe(350);expect(call[2].maxRetries).toBe(0);expect(call[3].storageOptions.saveMessages).toBe('none');
  vi.unstubAllEnvs();
});
