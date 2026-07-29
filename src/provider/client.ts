import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { LMSTUDIO_URL, type Profile } from "./profiles.ts";

const lmstudio = createOpenAICompatible({
  name: "lmstudio",
  baseURL: `${LMSTUDIO_URL}/v1`,
});

export function mainModel(profile: Profile) {
  return lmstudio(profile.model);
}

export function smallModel(profile: Profile) {
  return lmstudio(profile.smallModel);
}
