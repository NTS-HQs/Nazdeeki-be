const OpenAI = require('openai');

class AIAgentService {
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    async processIntentBasedOrder(userInput) {
        const prompt = `
        User wants to order food with this request: "${userInput}"
        Extract: cuisine type, budget, dietary restrictions, delivery preference.
        Return JSON format: {
            "cuisine": string,
            "budget": number,
            "dietary": string[],
            "delivery": "delivery|pickup|dine-in",
            "confidence": 0-1
        }`;

        const response = await this.openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
        });

        return JSON.parse(response.choices[0].message.content);
    }

    async analyzeFoodSentiment(restaurantId) {
        // Simulate social sentiment analysis
        const sentimentScore = Math.random();
        const trending = sentimentScore > 0.7;
        
        return {
            score: sentimentScore,
            trending,
            recommendation: trending ? "high_demand" : "normal"
        };
    }
}

module.exports = AIAgentService;
