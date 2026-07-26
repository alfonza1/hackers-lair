function resolveReference(rootSchema, reference) {
  if (!reference.startsWith('#/')) throw new Error(`Unsupported schema reference: ${reference}`);
  return reference.slice(2).split('/').reduce((value, segment) => (
    value?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')]
  ), rootSchema);
}

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function validateNode(value, schema, rootSchema, location, errors) {
  if (schema.$ref) {
    const resolved = resolveReference(rootSchema, schema.$ref);
    if (!resolved) {
      errors.push(`${location}: unresolved schema reference ${schema.$ref}`);
      return;
    }
    validateNode(value, resolved, rootSchema, location, errors);
    return;
  }

  if (schema.type) {
    const actual = valueType(value);
    const valid = schema.type === 'number'
      ? actual === 'number' || actual === 'integer'
      : schema.type === actual;
    if (!valid) {
      errors.push(`${location}: expected ${schema.type}, received ${actual}`);
      return;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${location}: expected one of ${schema.enum.join(', ')}`);
  }
  if (typeof value === 'string' && schema.minLength && value.length < schema.minLength) {
    errors.push(`${location}: must not be empty`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${location}: must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${location}: must be at most ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location}: requires at least ${schema.minItems} item(s)`);
    }
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      errors.push(`${location}: items must be unique`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateNode(item, schema.items, rootSchema, `${location}[${index}]`, errors));
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!(required in value)) errors.push(`${location}.${required}: is required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in value) validateNode(value[key], childSchema, rootSchema, `${location}.${key}`, errors);
    }
  }
}

function schemaErrors(value, schema) {
  const errors = [];
  validateNode(value, schema, schema, '$', errors);
  return errors;
}

function assertSchema(value, schema) {
  const errors = schemaErrors(value, schema);
  if (errors.length) throw new Error(errors.join('; '));
  return value;
}

module.exports = { assertSchema, schemaErrors };
