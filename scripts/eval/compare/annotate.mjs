#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertValidAnnotationsForManifest,
  canonicalize,
  defaultEvidenceDir,
  ensureNewDirectory,
  loadManifestEvidence,
  manifestDigest,
  parseArgs,
  readJson,
  sha256File,
  utcNow,
  writeJsonNew,
} from './lib.mjs';

function selectMedia(manifest, role) {
  const media = manifest.files.filter((item) => item.mimeType.startsWith('video/'));
  if (role) return media.find((item) => item.role === role) ?? null;
  if (media.length !== 1) throw new Error(`Manifest has ${media.length} videos; use --role to choose exactly one`);
  return media[0];
}

export function annotationTemplate(manifest, manifestFile, media, { annotator, role, independent }) {
  return {
    schemaVersion: 1,
    captureId: manifest.captureId,
    annotator: { id: annotator, role, independentOfBuilder: independent },
    source: { mediaSha256: media.sha256, manifestSha256: manifestDigest(manifestFile) },
    events: [],
    adjudication: role === 'adjudicator' ? { reviewedFiles: [], decisions: [] } : null,
  };
}

export function normalizeAnnotations(value) {
  return {
    ...canonicalize(value),
    events: [...value.events]
      .map((event) => canonicalize(event))
      .sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id)),
  };
}

export async function annotate(options) {
  const manifestFile = resolve(options.manifest ?? '');
  if (!options.manifest || !existsSync(manifestFile)) throw new Error('--manifest must name a capture manifest');
  const { manifest, mediaProbes } = loadManifestEvidence(manifestFile, { verifyFiles: true, verifyMedia: true });
  if (manifest.status !== 'captured') throw new Error(`Cannot annotate a ${manifest.status} capture`);
  const media = selectMedia(manifest, options.role);
  if (!media) throw new Error(`No video with role ${options.role ?? '(only video)'} exists`);
  const out = ensureNewDirectory(options.output_dir ?? defaultEvidenceDir('annotations'), { rawEvidence: true });
  const annotator = options.evaluator ?? 'unassigned-annotator';
  const annotatorRole = options.annotator_role ?? 'primary';
  if (!['primary', 'secondary', 'adjudicator'].includes(annotatorRole)) throw new Error('--annotator-role must be primary, secondary or adjudicator');
  const independent = options.independent === true;
  let value;
  if (options.template) {
    if (annotatorRole === 'adjudicator') throw new Error('An adjudicator file must name completed primary/secondary hashes and decisions; an empty adjudicator template is not valid evidence');
    value = annotationTemplate(manifest, manifestFile, media, { annotator, role: annotatorRole, independent });
  } else {
    const input = resolve(options.annotations ?? '');
    if (!options.annotations || !existsSync(input)) throw new Error('--annotations is required unless --template is used');
    value = readJson(input);
    if (options.evaluator && value.annotator?.id !== annotator) throw new Error('Annotation evaluator does not match --evaluator');
    if (options.annotator_role && value.annotator?.role !== annotatorRole) throw new Error('Annotation role does not match --annotator-role');
    if (options.independent && value.annotator?.independentOfBuilder !== true) throw new Error('Annotation does not attest independentOfBuilder=true');
  }
  assertValidAnnotationsForManifest(value, manifest, { mediaProbes });
  if (value.source.mediaSha256 !== media.sha256) throw new Error('Annotation media hash does not match the selected capture media');
  const digest = manifestDigest(manifestFile);
  if (value.source.manifestSha256 !== digest) throw new Error('Annotation manifest hash does not match the selected capture manifest');
  const normalized = normalizeAnnotations(value);
  assertValidAnnotationsForManifest(normalized, manifest, { mediaProbes });
  const annotationFile = writeJsonNew(join(out, options.template ? 'annotation-template.json' : 'annotations.json'), normalized);
  const receipt = {
    schemaVersion: 1,
    captureId: manifest.captureId,
    createdAtUtc: utcNow(),
    sourceManifest: { path: manifestFile, sha256: digest },
    sourceMedia: { path: resolve(dirname(manifestFile), media.path), sha256: media.sha256 },
    annotation: { path: basename(annotationFile), sha256: sha256File(annotationFile), eventCount: normalized.events.length },
    status: options.template ? 'TEMPLATE_NOT_EVIDENCE' : 'VALIDATED_ANNOTATION',
    limitations: options.template ? ['Empty templates are not evidence.'] : [],
  };
  const receiptFile = writeJsonNew(join(out, 'annotation-receipt.json'), receipt);
  return { ok: true, status: receipt.status, output: out, annotations: annotationFile, receipt: receiptFile };
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { booleans: ['help', 'template', 'independent'] });
  if (options.help) {
    process.stdout.write('Usage: node scripts/eval/compare/annotate.mjs --manifest FILE (--annotations FILE | --template) [--role raw_video] [--evaluator ID] [--annotator-role primary|secondary|adjudicator] [--independent] [--output-dir DIR]\nThis creates a validated sidecar only; it never burns competitor media into a new file.\n');
    return;
  }
  const result = await annotate(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`annotate: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
