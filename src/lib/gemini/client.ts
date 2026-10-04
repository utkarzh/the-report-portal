import { GoogleGenerativeAI } from "@google/generative-ai";

let geminiClient: GoogleGenerativeAI | null = null;

// Lazy singleton, same pattern as the Anthropic and OpenAI clients. Used only
// by the Copywriting Tool's research stage: a second, independent AI checks a
// writer-flagged claim against approved outside sources before it can be
// added to an article (see lib/copywriting.ts).
export function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }
  return geminiClient;
}

// Gemini model for the Copywriting Tool's research (with Google Search
// grounding). Override with GEMINI_MODEL; defaults to gemini-3.6-flash.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
