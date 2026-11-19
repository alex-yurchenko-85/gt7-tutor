import { describe, expect, it } from 'vitest';
import { eventKey, eventKeyKind, eventKeyPlace } from '../src/domain.ts';

describe('event keys', () => {
  it('event_key_is_kind_at_rounded_place', () => {
    expect(eventKey('brake', 290.6)).toBe('brake@291');
    expect(eventKey('big-stop', 1200.2)).toBe('big-stop@1200');
    expect(eventKey('keep-left', 406.4)).toBe('keep-left@406');
  });

  it('event_key_kind_reads_every_stored_key_format', () => {
    expect(eventKeyKind('brake@291')).toBe('brake');
    expect(eventKeyKind('ease-off@564')).toBe('ease-off');
    expect(eventKeyKind('throttle@411')).toBe('throttle');
    expect(eventKeyKind('big-stop@291')).toBe('big-stop');
    expect(eventKeyKind('tighter@2')).toBe('tighter');
    expect(eventKeyKind('keep-left@406')).toBe('keep-left');
    expect(eventKeyKind('keep-right@685')).toBe('keep-right');
    expect(eventKeyKind('guidance-paused#1')).toBe('guidance');
    expect(eventKeyKind('guidance-resumed#2')).toBe('guidance');
    expect(eventKeyKind('focus')).toBe('focus');
    expect(eventKeyKind('corner-1')).toBeNull();
    expect(eventKeyKind('other@3')).toBeNull();
  });

  it('event_key_place_is_the_place_of_placed_keys_only', () => {
    expect(eventKeyPlace('brake@291')).toBe(291);
    expect(eventKeyPlace('big-stop@1200')).toBe(1200);
    expect(eventKeyPlace('keep-right@685')).toBe(685);
    expect(eventKeyPlace('tighter@2')).toBeNull();
    expect(eventKeyPlace('guidance-paused#1')).toBeNull();
    expect(eventKeyPlace('focus')).toBeNull();
  });
});
