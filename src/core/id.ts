import { customAlphabet } from "nanoid";

// Unguessable deploy id (ADR-0001 §D21): 10-char base62 (~62^10 space).
const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const shortId = customAlphabet(alphabet, 10);
