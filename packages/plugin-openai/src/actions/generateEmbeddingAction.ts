
import { Action } from "@elizaos/core";
import { validatePrompt, validateApiKey, callOpenAiApi } from "./action";

export const generateEmbeddingAction: Action = {
    name: "generateEmbedding",
    description: "Generate embeddings using OpenAI",
    async handler(runtime, message, state) {
        const input = message.content.text?.trim() || "";
        validatePrompt(input);

        const apiKey = validateApiKey();
        const requestData = {
            model: "text-embedding-ada-002",
            input,
        };

        const response = await callOpenAiApi("https://api.openai.com/v1/embeddings", requestData, apiKey);
        return response.data.map((item) => item.embedding);
    },
};
