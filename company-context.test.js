import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyContext, companyMentions } from './company-context.js';
const user = content => ({role:'user',content});
test('recognizes company names and spacing without ambiguous AI abbreviations',()=>{
 assert.deepEqual(companyMentions('CallStream AI and Alpha-Drive AI'),['Call Stream AI','Alpha Drive AI']);
 assert.deepEqual(companyMentions('AI sales or ADA'),[]);
});
test('follow-up retains the user company, not assistant mentions',()=>{
 const scope=companyContext([user('Alpha Drive AI sales'),{role:'assistant',content:'Call Stream AI'},user('And billing?')]);
 assert.deepEqual(scope.companies,['Alpha Drive AI']); assert.equal(scope.origin,'prior_user_turn'); assert.match(scope.queries[0],/^Alpha Drive AI:/);
});
test('explicit switch overrides prior company',()=>{
 assert.deepEqual(companyContext([user('Alpha Drive AI billing'),user('How is Call Stream AI sales?')]).companies,['Call Stream AI']);
});
test('comparison retrieves both company contexts independently',()=>{
 const scope=companyContext([user('Compare Call Stream AI and Alpha Drive AI billing')]); assert.equal(scope.queries.length,2); assert.equal(scope.origin,'explicit');
});
test('new ambiguous conversation has no default company',()=>{
 assert.deepEqual(companyContext([user('How is billing going?')]),{companies:[],origin:'unspecified',queries:['How is billing going?']});
});

test('ADAI Fireflies summaries belong to Alpha Drive context',()=>{
 assert.deepEqual(companyMentions('Fireflies: ADAI weekly meeting'),['Alpha Drive AI']);
 assert.deepEqual(companyContext([user('ADAI sales'),user('What did Fireflies say?')]).companies,['Alpha Drive AI']);
});
