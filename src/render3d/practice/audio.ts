/**
 * Practice's sound and haptics through src/audio (synthesised, no recorded audio): the match voices for the
 * delivery and the field (release, pitch, pad, stumps, catch, boundary, crowd) and the batter's own contact feels.
 * One distinct sound and haptic each:
 *
 *   sweet   bat crack, bright ring, a firm pulse and a beat (feel 'double')
 *   middle  bat crack, ring, one medium pulse
 *   edge    a thin edge click, one short tick
 *   pad     the pad's thud, a light tap
 *   miss    the bat's swish, no vibration
 *   bowled  stumps and bails, the crowd's roar, a heavy pulse
 *   catch   the catch, the roar, a heavy pulse
 *   four    roar and drums, the success pattern (six: louder, longer)
 *
 * Every call arrives at the event's simulation timestamp (the stage schedules them); src/audio honours the Sound
 * and Vibration settings, the autoplay unlock and the background rule.
 */
import { MatchAudio, haptic, playContactFeel, playSwingFeel } from '@/audio';
import type { SceneEventKind } from '../core/choreo';
import type { ContactFeel, PracticeSink } from './types';

export interface PracticeAudio extends PracticeSink {
  dispose(): void;
}

export function createPracticeAudio(): PracticeAudio {
  // liveContact: the scene's own bat and edge cues stay silent (the feel plays them, once).
  const match = new MatchAudio({ liveContact: true });
  return {
    cue(kind: SceneEventKind, intensity: number, rate: number) {
      match.cue(kind, intensity, rate);
    },
    crowd(level: number) {
      match.crowd(level);
    },
    feel(feel: ContactFeel, intensity: number) {
      switch (feel) {
        case 'sweet':
          playContactFeel('middle', 'perfect', 'none');
          break;
        case 'middle':
          playContactFeel('middle', 'good', 'none');
          break;
        case 'edge':
          playContactFeel(intensity >= 0.65 ? 'thick_edge' : 'thin_edge', 'early', 'none');
          break;
        case 'pad':
          haptic('light');
          break;
        case 'miss':
          playSwingFeel('miss');
          break;
        default:
          // Bowled, catch and boundaries sound and buzz through their scene cue (stumps, catch, boundary, six).
          break;
      }
    },
    dispose() {
      match.dispose();
    },
  };
}
