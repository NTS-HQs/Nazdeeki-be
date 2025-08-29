const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    socket.on('join-restaurant', (restaurantId) => {
        socket.join(`restaurant-${restaurantId}`);
    });
    
    socket.on('join-customer', (customerId) => {
        socket.join(`customer-${customerId}`);
    });
});

// Order status broadcast function
function broadcastOrderUpdate(orderId, status, restaurantId, customerId) {
    io.to(`restaurant-${restaurantId}`).emit('order-updated', { orderId, status });
    io.to(`customer-${customerId}`).emit('order-status', { orderId, status });
}

module.exports = { io, broadcastOrderUpdate };
