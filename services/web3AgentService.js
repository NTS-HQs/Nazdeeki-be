const { AgentKit } = require('@0xgasless/agentkit');

class Web3AgentService {
    constructor() {
        this.agentKit = new AgentKit({
            privateKey: process.env.AGENT_PRIVATE_KEY,
            rpcUrl: process.env.AVALANCHE_RPC_URL,
            chainId: parseInt(process.env.CHAIN_ID),
        });
    }

    async createGaslessOrder(orderData) {
        const transaction = await this.agentKit.executeContract({
            address: process.env.NAZDEEKI_CORE_CONTRACT,
            abi: NazdeekiCoreABI,
            functionName: 'createGaslessOrder',
            args: [orderData.customer, orderData.restaurant, orderData.amount, orderData.orderId],
            gasless: true
        });
        return transaction;
    }

    async distributeLoyaltyTokens(userAddress, amount) {
        const transaction = await this.agentKit.executeContract({
            address: process.env.FOOD_TOKEN_CONTRACT,
            abi: FoodTokenABI,
            functionName: 'mint',
            args: [userAddress, amount],
            gasless: true
        });
        return transaction;
    }
}

module.exports = Web3AgentService;
