/**
 * Form evidence on this device: the compact, versioned per-ball samples the coach engine makes (formSample) and
 * turns into a FormReport (formFromAttempts). Form is a report of demonstrated skill; nothing here changes play.
 * The samples are otherwise opaque to the store, but both their schema and Practice simulation versions are checked
 * here so evidence from different physics can never survive as current form.
 */
import { PRACTICE_SIM_VERSION } from '@/contracts';
import { FORM_SAMPLE_VERSION } from '@/practice/coach/form';
import { PRACTICE_KEYS, isObj, localStore, readJson, writeJson, type KeyStore } from './storage';

const FORM_MAX_SAMPLES = 300;

/** A sample as stored: a plain JSON object with a version (its shape belongs to src/practice/coach). */
export type StoredSample = Record<string, unknown> & {
  v: typeof FORM_SAMPLE_VERSION;
  simVersion: typeof PRACTICE_SIM_VERSION;
};

const isSample = (v: unknown): v is StoredSample =>
  isObj(v) && v.v === FORM_SAMPLE_VERSION && v.simVersion === PRACTICE_SIM_VERSION;

export function loadFormSamples(store: KeyStore | null = localStore()): StoredSample[] {
  const raw = readJson(store, PRACTICE_KEYS.form);
  if (!isObj(raw) || raw.v !== 2 || raw.simVersion !== PRACTICE_SIM_VERSION || !Array.isArray(raw.samples)) return [];
  return raw.samples.filter(isSample).slice(-FORM_MAX_SAMPLES);
}

/** Appends one sample (the oldest beyond the limit are dropped); false when storage is unavailable or full. */
export function addFormSample(sample: object, store: KeyStore | null = localStore()): boolean {
  if (!isSample(sample)) return false;
  const samples = [...loadFormSamples(store), sample].slice(-FORM_MAX_SAMPLES);
  return writeJson(store, PRACTICE_KEYS.form, { v: 2, simVersion: PRACTICE_SIM_VERSION, samples });
}
