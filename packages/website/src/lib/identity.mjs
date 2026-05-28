// Single source of truth for the Person JSON-LD entity. Validated at module
// load so a malformed identity.json fails the Astro build rather than
// emitting silently broken structured data.
import { z } from 'astro:content';
import identityData from '../../content/identity.json';

const schema = z.object({
  name: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  jobTitle: z.object({ fr: z.string(), en: z.string() }),
  affiliation: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
  })),
  sameAs: z.array(z.string().url()),
});

export const identity = schema.parse(identityData);
