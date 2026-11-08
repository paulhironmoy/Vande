/**
 * The crowd's emotion, the one emotion source for Practice: the pure model (emotionCore.ts), its transitions and the
 * machine (emotionMachine.ts), and the match situation it reads (situation.ts). Import-safe anywhere: nothing here
 * touches Web Audio or the audio graph, so render3d imports '@/audio/emotion' directly.
 */
export * from './emotionCore';
export * from './emotionMachine';
export * from './situation';
