import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  briefProposal,
  conceptProposalSet,
  contentPlan,
  contentProposalSet,
  opportunityProposalSet,
  personaProposalSet,
} from '@c360/contracts';
import { toStrictJsonSchema } from '../../src/core/ai/strict-schema.js';

/**
 * OpenAI's strict Structured Outputs mode accepts only a subset of JSON Schema,
 * and a schema it rejects fails the whole call. These tests are what makes the
 * conversion trustworthy without a provider key: every contract the product
 * actually sends is converted and checked against the documented rules.
 *
 * The division of labour being verified: **OpenAI enforces the shape, Zod
 * enforces the rules.** So the converted schema keeps the structure and drops
 * the validation keywords, which the response is re-checked against afterwards.
 */

/** Walks every object node in a converted schema. */
function objectNodes(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      objectNodes(item, found);
    }
    return found;
  }
  if (typeof node !== 'object' || node === null) {
    return found;
  }
  const record = node as Record<string, unknown>;
  const type = record.type;
  const isObjectSchema =
    type === 'object' || (Array.isArray(type) && (type as unknown[]).includes('object'));
  if (isObjectSchema && typeof record.properties === 'object' && record.properties !== null) {
    found.push(record);
  }
  for (const value of Object.values(record)) {
    objectNodes(value, found);
  }
  return found;
}

function collectKeys(node: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectKeys(item, keys);
    }
    return keys;
  }
  if (typeof node !== 'object' || node === null) {
    return keys;
  }
  for (const [key, value] of Object.entries(node)) {
    keys.add(key);
    collectKeys(value, keys);
  }
  return keys;
}

/** Every schema the product sends to a provider. */
const CONTRACTS = {
  'persona.propose': personaProposalSet,
  'opportunity.propose': opportunityProposalSet,
  'brief.draft': briefProposal,
  'concept.propose': conceptProposalSet,
  'content.plan': contentPlan,
  'content.generate': contentProposalSet,
} as const;

describe('strict schema conversion', () => {
  for (const [name, schema] of Object.entries(CONTRACTS)) {
    describe(name, () => {
      const jsonSchema = z.toJSONSchema(schema, { io: 'output' });
      const { schema: strict } = toStrictJsonSchema(jsonSchema);

      it('lists every property in required on every object', () => {
        // Strict mode has no concept of an optional key: omitting one from
        // `required` is rejected outright.
        for (const node of objectNodes(strict)) {
          const properties = Object.keys(node.properties as Record<string, unknown>);
          expect(node.required).toEqual(properties);
        }
      });

      it('sets additionalProperties false on every object', () => {
        for (const node of objectNodes(strict)) {
          expect(node.additionalProperties).toBe(false);
        }
      });

      it('drops every validation keyword strict mode rejects', () => {
        const keys = collectKeys(strict);
        for (const forbidden of [
          'minLength',
          'maxLength',
          'pattern',
          'format',
          'minimum',
          'maximum',
          'minItems',
          'maxItems',
          'default',
          'const',
        ]) {
          expect(keys.has(forbidden)).toBe(false);
        }
      });

      it('does not use oneOf, which is outside the subset', () => {
        expect(collectKeys(strict).has('oneOf')).toBe(false);
      });

      it('keeps a root object schema', () => {
        expect(strict.type).toBe('object');
      });
    });
  }

  it('makes an optional property nullable rather than omitting it', () => {
    // The contract says this key may be absent; strict mode cannot express
    // that, so it must become explicitly nullable instead.
    const withOptional = z.object({
      always: z.string(),
      sometimes: z.string().optional(),
    });
    const { schema } = toStrictJsonSchema(z.toJSONSchema(withOptional, { io: 'output' }));

    expect(schema.required).toEqual(['always', 'sometimes']);

    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const sometimes = properties.sometimes;
    // Either a type union including null, or an anyOf with a null branch.
    const acceptsNull =
      (Array.isArray(sometimes?.type) && (sometimes.type as unknown[]).includes('null')) ||
      (Array.isArray(sometimes?.anyOf) &&
        (sometimes.anyOf as Record<string, unknown>[]).some((b) => b.type === 'null'));
    expect(acceptsNull).toBe(true);
  });

  it('requires the per-piece creative direction in structured output while allowing null for text-only content', () => {
    const { schema } = toStrictJsonSchema(z.toJSONSchema(contentProposalSet, { io: 'output' }));
    const item = objectNodes(schema).find(node => Object.hasOwn(node.properties as object, 'creativeBrief'));
    expect(item).toBeDefined();
    expect(item!.required).toContain('creativeBrief');
    const creative = (item!.properties as Record<string, Record<string, unknown>>).creativeBrief!;
    expect((creative.anyOf as Record<string, unknown>[]).some(branch => branch.type === 'null')).toBe(true);
    const direction = objectNodes(creative)[0]!;
    expect(direction.required).toContain('audienceInsight');
    expect(direction.required).toContain('textTreatment');
    expect(direction.required).toContain('textPosition');
    expect(direction.required).toContain('brandIntegration');
    expect(direction.required).toContain('campaignAlignment');
    expect(direction.required).toContain('channelRationale');
    expect(direction.required).toContain('personaVersionIds');
    expect(direction.required).toContain('evidenceIds');
    expect(direction.required).toContain('testHypothesis');
    expect(direction.additionalProperties).toBe(false);
  });

  it('leaves an already-nullable property alone', () => {
    const schema = z.object({ note: z.string().nullable() });
    const { schema: strict } = toStrictJsonSchema(z.toJSONSchema(schema, { io: 'output' }));
    const properties = strict.properties as Record<string, Record<string, unknown>>;

    const type = properties.note?.type;
    const anyOf = properties.note?.anyOf;
    const nullBranches =
      (Array.isArray(type) ? (type as unknown[]).filter((t) => t === 'null').length : 0) +
      (Array.isArray(anyOf)
        ? (anyOf as Record<string, unknown>[]).filter((b) => b.type === 'null').length
        : 0);
    // Exactly one null, not two — the conversion must be idempotent in effect.
    expect(nullBranches).toBe(1);
  });

  it('reports how many keywords it dropped', () => {
    // Used for logging: a schema that loses many constraints is worth noticing,
    // because Zod is then carrying all of the enforcement.
    const { droppedKeywordCount } = toStrictJsonSchema(
      z.toJSONSchema(personaProposalSet, { io: 'output' }),
    );
    expect(droppedKeywordCount).toBeGreaterThan(0);
  });

  it('refuses a non-object root, which strict mode cannot accept', () => {
    expect(() => toStrictJsonSchema(z.toJSONSchema(z.array(z.string()), { io: 'output' }))).toThrow(
      /object at the root/u,
    );
  });

  it('produces a schema that is JSON-serialisable', () => {
    // It is sent over the wire, so anything non-serialisable would fail at the
    // provider rather than here.
    for (const schema of Object.values(CONTRACTS)) {
      const { schema: strict } = toStrictJsonSchema(z.toJSONSchema(schema, { io: 'output' }));
      expect(() => JSON.stringify(strict)).not.toThrow();
    }
  });
});
