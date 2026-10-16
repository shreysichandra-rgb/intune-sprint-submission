import {v} from 'convex/values';
const stage=v.object({stage:v.string(),ms:v.number(),runs:v.number(),failed:v.number(),inputChars:v.optional(v.number()),contextChars:v.optional(v.number()),aiCalls:v.optional(v.number())});
export const timingSnapshot=v.object({scope:v.string(),totalMs:v.number(),stages:v.array(stage)});
