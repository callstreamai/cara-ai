import crypto from 'node:crypto';

export function seal(value, secret) {
  if (!secret || secret.length < 32) throw new Error('Slack session secret is not configured');
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
export function unseal(raw, secret) {
  try {
    if (!secret || secret.length < 32 || !raw || raw.length > 8192) return null;
    const b = Buffer.from(raw, 'base64url');
    if (b.length < 29) return null;
    const cipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(secret).digest(), b.subarray(0, 12));
    cipher.setAuthTag(b.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString('utf8'));
    if (!value.exp || value.exp < Date.now()) return null;
    return value;
  } catch { return null; }
}
export function cookieValue(header, name) {
  return (header || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '';
}
export function challenge(verifier) { return crypto.createHash('sha256').update(verifier).digest('base64url'); }
