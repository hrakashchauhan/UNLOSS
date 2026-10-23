import {describe,it,expect} from 'vitest';
import {hashToken,isTransitionAllowed,reportMonthBounds,rewardEligible} from '../src/rules.js';

describe('shared business rules',()=>{
  it('allows only documented lifecycle transitions',()=>{
    expect(isTransitionAllowed('CREATED','READY_FOR_DISPATCH')).toBe(true);
    expect(isTransitionAllowed('DELIVERY_ATTEMPTED','RETURN_INITIATED')).toBe(true);
    expect(isTransitionAllowed('DELIVERED_VERIFIED','RETURN_INITIATED')).toBe(false);
    expect(isTransitionAllowed('CANCELLED','READY_FOR_DISPATCH')).toBe(false);
  });
  it('hashes QR tokens deterministically without retaining raw values',()=>{
    const digest=hashToken('high-entropy-token');
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain('high-entropy-token');
    expect(hashToken('high-entropy-token')).toBe(digest);
  });
  it('uses Kolkata calendar month boundaries expressed as UTC instants',()=>{
    const [start,end]=reportMonthBounds('2026-01');
    expect(start.toISOString()).toBe('2025-12-31T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-01-31T18:30:00.000Z');
    expect(()=>reportMonthBounds('2026-13')).toThrow();
  });
  it('requires both verified customer acceptance and delivery handoff for rewards',()=>{
    expect(rewardEligible(false,true)).toBe(false);
    expect(rewardEligible(true,false)).toBe(false);
    expect(rewardEligible(true,true)).toBe(true);
  });
});
