import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function sealToken(token: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(`qr-vault:${secret}`).digest(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
export function openToken(value: string, secret: string) {
  // Read legacy draft records; all new writes use authenticated encryption.
  if (!value.startsWith('v1.')) return Buffer.from(value, 'base64url').toString('utf8');
  const [, iv, tag, ciphertext] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(`qr-vault:${secret}`).digest(), Buffer.from(iv!, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag!, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext!, 'base64url')), decipher.final()]).toString('utf8');
}
