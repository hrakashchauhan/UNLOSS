import {expect,it} from 'vitest';
import {sealToken,openToken} from '../src/token-vault.js';
import {nextPayoutMonday} from '../src/parcel-workspace.js';
it('authenticates encrypted QR storage and rejects changed ciphertext or keys',()=>{const raw='x'.repeat(43),secret='s'.repeat(40);const encrypted=sealToken(raw,secret);expect(openToken(encrypted,secret)).toBe(raw);expect(encrypted).not.toContain(raw);expect(()=>openToken(encrypted,'other')).toThrow();const parts=encrypted.split('.');parts[3]=(parts[3]![0]==='A'?'B':'A')+parts[3]!.slice(1);expect(()=>openToken(parts.join('.'),secret)).toThrow();});
it('schedules the next Monday at 10:00 India time',()=>{expect(nextPayoutMonday(new Date('2026-10-24T10:00:00Z')).toISOString()).toBe('2026-10-26T04:30:00.000Z');});
