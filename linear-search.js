// Linear results are shared with all authenticated CARA users. The credential
// must be restricted to data approved for that audience.
export function linearTerms(question) {
  const text = String(question || '').slice(0, 1000);
  const ids = text.match(/\b[A-Z][A-Z0-9]+-\d+\b/gi) || [];
  const stop = new Set('what when where who why how is are the a an for of to and or on in with about tell me show our my do does did can could would please latest status update updates ticket tickets issue issues linear call stream ai'.split(' '));
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  return [...new Set([...ids, ...words.filter(w => !stop.has(w) && !/^[a-z][a-z0-9]+-\d+$/.test(w))])].slice(0, 5);
}
const QUERY = `query Search($term: String!) {
  searchIssues(term: $term, first: 10, includeComments: true) {
    nodes { id identifier title description url updatedAt state { name } assignee { name } team { name } }
  }
}`;
export async function searchLinear(question, key, request = fetch) {
  const terms = linearTerms(question);
  if (!terms.length) return { issues: [], terms, coverage: 'No specific Linear search terms were available.' };
  const found = new Map();
  for (const term of terms) {
    const response = await request('https://api.linear.app/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ query: QUERY, variables: { term } }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Linear HTTP ${response.status}`);
    const body = await response.json();
    if (body.errors?.length || !Array.isArray(body.data?.searchIssues?.nodes)) throw new Error('Linear query failed');
    for (const issue of body.data.searchIssues.nodes) {
      if (!found.has(issue.id)) found.set(issue.id, {
        identifier: issue.identifier, title: issue.title, description: String(issue.description || '').slice(0, 4000),
        url: issue.url, updated_at: issue.updatedAt, status: issue.state?.name || null,
        assignee: issue.assignee?.name || null, team: issue.team?.name || null,
      });
    }
  }
  return { issues: [...found.values()].slice(0, 20), terms, coverage: 'Keyword search, up to 10 matches per term and 20 total; results may be incomplete.' };
}
