/**
 * Clef is Cloudflare's decision model and it can look at images, so it classifies the screenshot directly with typed yes/no
 * questions — no separate vision model, and the answers are probabilities rather than prose. Images must be base64 (no URLs).
 */
import type { VisionAnswers } from "./report";

export interface AiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<any>;
}

export const VISION_QUESTIONS = {
  consent_banner_visible: { type: "noul", instructions: "Is a cookie or privacy consent banner, dialog or notice visible in this screenshot?" },
  low_contrast_text: { type: "noul", instructions: "Is any text in this screenshot hard to read because its color is too close to its background?" },
  layout_broken: { type: "noul", instructions: "Does the page layout look broken, with overlapping content, content cut off, or missing styles?" },
} as const;

export async function classifyScreenshot(ai: AiBinding, jpegBase64: string): Promise<VisionAnswers> {
  const res = await ai.run("@cf/cloudflare/clef", {
    model: "clef",
    state: "A screenshot of a web page taken right after it finished loading, before anyone interacted with it.",
    questions: VISION_QUESTIONS,
    images: [`data:image/jpeg;base64,${jpegBase64}`],
  });
  const answers = (res?.answers ? res : res?.result)?.answers;
  const read = (k: keyof VisionAnswers): number => {
    const p = answers?.[k]?.noul;
    if (typeof p !== "number") throw new Error(`Clef returned no answer for ${k}`);
    return p;
  };
  return { consent_banner_visible: read("consent_banner_visible"), low_contrast_text: read("low_contrast_text"), layout_broken: read("layout_broken") };
}
