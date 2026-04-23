import { describe, it, expect } from 'vitest';
import {
  EXPECTED_SUPABASE_REF,
  FORBIDDEN_SUPABASE_REFS,
  extractSupabaseRef,
  assertSmartAiRef,
} from '@/lib/config';

describe('config / D8 tripwire', () => {
  it('expected ref is the Smart AI project', () => {
    expect(EXPECTED_SUPABASE_REF).toBe('tapbgvbglqacamhayfel');
  });

  it('forbids v1 prod and v1 sandbox refs explicitly', () => {
    expect(FORBIDDEN_SUPABASE_REFS).toContain('ydzipybqeebtpcvsbtvs');
    expect(FORBIDDEN_SUPABASE_REFS).toContain('xjcxlmlpeywtwkhstjlw');
  });

  it('extracts ref from a canonical Supabase URL', () => {
    expect(extractSupabaseRef('https://tapbgvbglqacamhayfel.supabase.co')).toBe('tapbgvbglqacamhayfel');
  });

  it('returns null for missing or malformed URLs', () => {
    expect(extractSupabaseRef(undefined)).toBeNull();
    expect(extractSupabaseRef('')).toBeNull();
    expect(extractSupabaseRef('not a url')).toBeNull();
  });

  it('assertSmartAiRef accepts the Smart AI ref', () => {
    expect(() => assertSmartAiRef('https://tapbgvbglqacamhayfel.supabase.co')).not.toThrow();
  });

  it('assertSmartAiRef throws on v1 prod ref', () => {
    expect(() => assertSmartAiRef('https://ydzipybqeebtpcvsbtvs.supabase.co')).toThrow(/v1 Supabase ref/);
  });

  it('assertSmartAiRef throws on v1 sandbox ref', () => {
    expect(() => assertSmartAiRef('https://xjcxlmlpeywtwkhstjlw.supabase.co')).toThrow(/v1 Supabase ref/);
  });

  it('assertSmartAiRef throws on unrelated ref', () => {
    expect(() => assertSmartAiRef('https://abcdefghij1234567890.supabase.co')).toThrow(/project ref mismatch/);
  });

  it('assertSmartAiRef throws on missing URL', () => {
    expect(() => assertSmartAiRef(undefined)).toThrow(/missing or malformed/);
  });
});
