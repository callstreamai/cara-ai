import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyContext, companyMentions } from './company-context.js';
const user = content => ({role:'user',content});
test('recognizes company names and spacing without ambiguous AI abbreviations',()=>{
 assert.deepEqual(companyMentions('CallStream AI and Alpha-Drive AI'),['Call Stream AI','Alpha Drive AI']);
 assert.deepEqual(companyMentions('AI sales or ADA'),[]);
});
test('unqualified questions default to Call Stream even after ADAI',()=>{
 const scope=companyContext([user('Alpha Drive AI sales'),{role:'assistant',content:'Call Stream AI'},user('And billing?')]);
 assert.deepEqual(scope.companies,['Call Stream AI']); assert.equal(scope.origin,'default_call_stream'); assert.match(scope.queries[0],/^Call Stream AI:/);
});
test('explicit switch overrides prior company',()=>{
 assert.deepEqual(companyContext([user('Alpha Drive AI billing'),user('How is Call Stream AI sales?')]).companies,['Call Stream AI']);
});
test('comparison retrieves both company contexts independently',()=>{
 const scope=companyContext([user('Compare Call Stream AI and Alpha Drive AI billing')]); assert.equal(scope.queries.length,2); assert.equal(scope.origin,'explicit');
});
test('unqualified billing defaults to Call Stream',()=>{
 assert.deepEqual(companyContext([user('How is billing going?')]),{companies:['Call Stream AI'],origin:'default_call_stream',queries:['Call Stream AI: How is billing going?']});
});

test('ADAI Fireflies summaries belong to Alpha Drive context',()=>{
 assert.deepEqual(companyMentions('Fireflies: ADAI weekly meeting'),['Alpha Drive AI']);
 assert.deepEqual(companyContext([user('ADAI sales'),user('What did Fireflies say?')]).companies,['Call Stream AI']);
});

test('client questions default to Call Stream client work',()=>{ assert.deepEqual(companyContext([user('How are our clients doing?')]).companies,['Call Stream AI']); });
