const express = require('express');
const Web3AgentService = require('../services/web3AgentService');
const AIAgentService = require('../services/aiAgentService');

const router = express.Router();
const web3Service = new Web3AgentService();
const aiService = new AIAgentService();

// Gasless order creation
router.post('/gasless-order', async (req, res) => {
    try {
        const { orderId, customerAddress, restaurantAddress, amount } = req.body;
        
        const txHash = await web3Service.createGaslessOrder({
            orderId, customer: customerAddress, 
            restaurant: restaurantAddress, amount
        });
        
        // Update database
        await db.query(
            'UPDATE orders SET tx_hash = $1, gasless_sponsored = true WHERE order_id = $2',
            [txHash, orderId]
        );
        
        res.json({ success: true, txHash });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// AI-powered order processing
router.post('/ai-order', async (req, res) => {
    try {
        const { userInput, userId } = req.body;
        
        const analysis = await aiService.processIntentBasedOrder(userInput);
        
        // Log AI interaction
        await db.query(
            'INSERT INTO ai_agent_logs (agent_type, user_id, input_data, output_data, confidence_score) VALUES ($1, $2, $3, $4, $5)',
            ['intent-based', userId, { userInput }, analysis, analysis.confidence]
        );
        
        res.json(analysis);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
