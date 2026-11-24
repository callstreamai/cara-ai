import test from 'node:test';
import assert from 'node:assert/strict';
import { linearTerms, searchLinear } from './linear-search.js';

test('searches bounded terms, deduplicates, and preserves issue links', async () => {
  assert.deepEqual(linearTerms('What is the status of CAL-123 and billing?'), ['CAL-123', 'billing']);
  let calls = 0;
  const request = async (_url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, 'test-key');
    return { ok: true, json: async () => ({ data: { searchIssues: { nodes: [{ id:'1', identifier:'CAL-123', title:'Billing', description:'details', url:'https://linear.app/example', updatedAt:'2026-11-01', state:{name:'Started'}, assignee:null, team:{name:'Team'} }] } } }) };
  };
  const result = await searchLinear('CAL-123 billing', 'test-key', request);
  assert.equal(calls, 2);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].url, 'https://linear.app/example');
});
test('rejects GraphQL and HTTP errors rather than returning partial evidence', async () => {
  await assert.rejects(searchLinear('billing', 'test-key', async () => ({ok:true, json:async()=>({errors:[{message:'denied'}]})})), /Linear query failed/);
  await assert.rejects(searchLinear('billing', 'test-key', async () => ({ok:false,status:429})), /429/);
});
