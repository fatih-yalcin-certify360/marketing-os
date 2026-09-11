/**
 * Converts a Zod-derived JSON Schema into OpenAI's strict Structured Outputs
 * subset.
 *
 * OpenAI's strict mode guarantees the *shape* of the response but accepts only
 * a subset of JSON Schema. Two of its rules are the ones that bite:
 *
 *  1. **Every object must list every property in `required`** and set
 *     `additionalProperties: false`. There is no notion of an optional key, so
 *     a property that our contract allows to be absent is expressed as a type
 *     union with `null` instead.
 *  2. **Validation keywords are not part of the guarantee.** `minLength`,
 *     `maxLength`, `minimum`, `pattern`, `format` and friends are dropped
 *     rather than sent.
 *
 * Dropping the constraints loses nothing, because the response is validated
 * with the original Zod schema afterwards. The division of labour is:
 * **OpenAI enforces the shape, Zod enforces the rules.** A response that has
 * the right shape but breaks a rule (a 400-character `hook`, say) becomes a
 * repair attempt, then a recorded `provider_invalid_output` failure — never a
 * partially-trusted result.
 *
 * Source: https://developers.openai.com/api/docs/guides/structured-outputs
 * (checked 2026-09-09).
 */

/** Keywords OpenAI's strict subset does not accept; safe to drop. */
const DROPPED_KEYWORDS = new Set([
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'default',
  'contentEncoding',
  'contentMediaType',
  'examples',
  'const',
  // Zod 4 emits these; they carry no meaning for the model.
  'id',
  '$schema',
]);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Adds `null` to a schema's type so an absent value can be expressed.
 *
 * A property that was optional in our contract must still appear in `required`
 * for OpenAI, so "may be absent" has to become "may be null". The Zod schema
 * that validates the response afterwards treats both the same way.
 */
function makeNullable(schema: JsonObject): JsonObject {
  const anyOf: unknown = schema.anyOf;
  if (Array.isArray(anyOf)) {
    const branches: unknown[] = anyOf;
    const hasNull = branches.some((branch) => isObject(branch) && branch.type === 'null');
    return hasNull ? schema : { ...schema, anyOf: [...branches, { type: 'null' }] };
  }

  const type = schema.type;
  if (typeof type === 'string') {
    return type === 'null' ? schema : { ...schema, type: [type, 'null'] };
  }
  if (Array.isArray(type)) {
    const members: unknown[] = type;
    return members.includes('null') ? schema : { ...schema, type: [...members, 'null'] };
  }
  // A bare `$ref` or an untyped schema cannot be made nullable in place; wrap it.
  return { anyOf: [schema, { type: 'null' }] };
}

/**
 * Rewrites one schema node.
 *
 * @param nullableKeys Property names that were optional on the parent object
 *   and therefore need a null branch.
 */
function convert(node: unknown, nullableKeys: ReadonlySet<string> = new Set()): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => convert(item));
  }
  if (!isObject(node)) {
    return node;
  }

  const result: JsonObject = {};

  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(key)) {
      continue;
    }

    if (key === 'properties' && isObject(value)) {
      const properties: JsonObject = {};
      for (const [propertyName, propertySchema] of Object.entries(value)) {
        const converted = convert(propertySchema);
        properties[propertyName] = nullableKeys.has(propertyName)
          ? makeNullable(converted as JsonObject)
          : converted;
      }
      result.properties = properties;
      continue;
    }

    if (key === '$defs' && isObject(value)) {
      const defs: JsonObject = {};
      for (const [defName, defSchema] of Object.entries(value)) {
        defs[defName] = convertObjectNode(defSchema);
      }
      result.$defs = defs;
      continue;
    }

    result[key] = convert(value);
  }

  return result;
}

/** Applies the object rules (all-required, no additional properties). */
function convertObjectNode(node: unknown): unknown {
  if (!isObject(node)) {
    return convert(node);
  }

  const isObjectSchema =
    node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'));

  if (!isObjectSchema || !isObject(node.properties)) {
    return convert(node);
  }

  const propertyNames = Object.keys(node.properties);
  const declaredRequired = Array.isArray(node.required)
    ? new Set((node.required as unknown[]).filter((v): v is string => typeof v === 'string'))
    : new Set<string>();

  // Anything the contract did not require becomes nullable, because strict mode
  // has no way to say "this key may be missing".
  const nullableKeys = new Set(propertyNames.filter((name) => !declaredRequired.has(name)));

  const converted = convert(node, nullableKeys) as JsonObject;

  return {
    ...converted,
    // Every property, in a stable order.
    required: propertyNames,
    additionalProperties: false,
  };
}

/** Recursively applies the object rules to every nested schema. */
function walk(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(walk);
  }
  if (!isObject(node)) {
    return node;
  }

  const withObjectRules = convertObjectNode(node);
  if (!isObject(withObjectRules)) {
    return withObjectRules;
  }

  const result: JsonObject = { ...withObjectRules };

  if (isObject(result.properties)) {
    const properties: JsonObject = {};
    for (const [name, schema] of Object.entries(result.properties)) {
      properties[name] = walk(schema);
    }
    result.properties = properties;
  }
  if (result.items !== undefined) {
    result.items = walk(result.items);
  }
  if (Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map(walk);
  }
  if (Array.isArray(result.oneOf)) {
    // OpenAI strict mode uses anyOf; oneOf is not part of the subset.
    result.anyOf = result.oneOf.map(walk);
    delete result.oneOf;
  }
  if (isObject(result.$defs)) {
    const defs: JsonObject = {};
    for (const [name, schema] of Object.entries(result.$defs)) {
      defs[name] = walk(schema);
    }
    result.$defs = defs;
  }

  return result;
}

export interface StrictSchemaResult {
  /** The schema to send as `text.format.schema`. */
  schema: JsonObject;
  /** Validation keywords that were dropped, for logging and for the ADR. */
  droppedKeywordCount: number;
}

/**
 * Produces a schema OpenAI's strict mode will accept.
 *
 * @param jsonSchema Output of `z.toJSONSchema(schema, { io: 'output' })`.
 */
export function toStrictJsonSchema(jsonSchema: unknown): StrictSchemaResult {
  let dropped = 0;
  countDropped(jsonSchema, () => {
    dropped += 1;
  });

  const schema = walk(jsonSchema);
  if (!isObject(schema)) {
    throw new Error('Strict schema conversion did not produce an object schema.');
  }

  // A top-level non-object schema cannot be used with strict mode; every
  // contract in this codebase is an object, so this is a guard, not a path.
  if (schema.type !== 'object' && !Array.isArray(schema.anyOf)) {
    throw new Error(
      `Strict Structured Outputs requires an object at the root; received type "${String(schema.type)}".`,
    );
  }

  return { schema, droppedKeywordCount: dropped };
}

function countDropped(node: unknown, onDrop: () => void): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      countDropped(item, onDrop);
    }
    return;
  }
  if (!isObject(node)) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(key)) {
      onDrop();
      continue;
    }
    countDropped(value, onDrop);
  }
}
