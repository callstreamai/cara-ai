// Context routing is relevance guidance, never an authorization boundary.
const COMPANIES = [
  { name: 'Call Stream AI', pattern: /\bcall[\s-]*stream(?:\s*ai)?\b/i },
  { name: 'Alpha Drive AI', pattern: /\balpha[\s-]*drive(?:\s*ai)?\b/i },
];
export function companyMentions(text) {
  return COMPANIES.filter(c => c.pattern.test(String(text || ''))).map(c => c.name);
}
export function companyContext(messages) {
  const turns = messages.filter(m => m?.role === 'user' && typeof m.content === 'string').slice(-20);
  const question = turns.at(-1)?.content || '';
  const explicit = companyMentions(question);
  let companies = explicit;
  if (!companies.length) {
    for (let i = turns.length - 2; i >= 0; i--) {
      companies = companyMentions(turns[i].content);
      if (companies.length) break;
    }
  }
  return { companies, origin: explicit.length ? 'explicit' : companies.length ? 'prior_user_turn' : 'unspecified',
    queries: companies.length ? companies.map(name => `${name}: ${question}`) : [question] };
}
export const COMPANY_RULES = `Company attribution rules: Call Stream AI and Alpha Drive AI are distinct company contexts. Never transfer one company's billing, pricing, sales, customers, incidents, or metrics to the other. The shared Slack workspace and CARA's branding do not establish which company a source describes. Check the source text and its thread context; channel names and detected company mentions are clues, not proof of ownership. A message mentioning both companies does not make its claims true for both. Attribute each claim to the company actually supported by the source, with its date and link. Do not infer corporate relationships or shared pricing. When comparing companies, give separate labeled sections and identify missing evidence separately. Prior assistant answers are not evidence. Explicit company changes in the latest request override earlier conversation context. Company context inherited from prior user turns is tentative: state the company you are answering about and clarify if the question implies a different or unclear company. If a company-specific question has no clear company context, ask whether the user means Call Stream AI, Alpha Drive AI, or both before giving company-specific figures. If evidence is unrelated, ambiguous, or insufficient, say so; never fill the gap with the other company's data. These are attribution rules, not access controls.`;
