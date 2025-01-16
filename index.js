const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cors = require("cors");
require('dotenv').config();

// Constants and Configuration
const PORT = process.env.PORT || 3000;
const FB_GRAPH_API_VERSION = "v21.0";
const FB_GRAPH_API_URL = "https://graph.facebook.com";

// Environment variables validation
const requiredEnvVars = ['TOKEN', 'MYTOKEN'];
requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
        console.error(`Missing required environment variable: ${varName}`);
        process.exit(1);
    }
});

// App setup
const app = express();
app.use(bodyParser.json());
app.use(cors());

// Client management
class ClientManager {
    constructor() {
        this.clients = new Set();
    }

    addClient(client) {
        this.clients.add(client);
        console.log(`New client connected. Total clients: ${this.clients.size}`);
    }

    removeClient(client) {
        this.clients.delete(client);
        console.log(`Client disconnected. Total clients: ${this.clients.size}`);
    }

    broadcast(message) {
        this.clients.forEach(client => {
            try {
                if (!client.res.writableEnded) {
                    client.res.write(`data: ${JSON.stringify(message)}\n\n`);
                }
            } catch (error) {
                console.error('Error broadcasting to client:', error);
                this.removeClient(client);
            }
        });
    }
}

const clientManager = new ClientManager();

// WhatsApp message handler
class WhatsAppHandler {
    static async sendMessage(phoneNumberId, to, message) {
        try {
            const response = await axios({
                method: "POST",
                url: `${FB_GRAPH_API_URL}/${FB_GRAPH_API_VERSION}/${phoneNumberId}/messages`,
                params: { access_token: process.env.TOKEN },
                data: {
                    messaging_product: "whatsapp",
                    to: to,
                    text: { body: message }
                },
                headers: { "Content-Type": "application/json" }
            });
            return response.data;
        } catch (error) {
            console.error('Error sending WhatsApp message:', error.response?.data || error.message);
            throw error;
        }
    }

    static extractMessageData(body) {
        if (!body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
            throw new Error('Invalid message format');
        }

        const change = body.entry[0].changes[0].value;
        return {
            phoneNumberId: change.metadata.phone_number_id,
            from: change.messages[0].from,
            messageBody: change.messages[0].text.body
        };
    }
}

// Routes
// Webhook verification endpoint
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = req.query["hub.verify_token"];

    if (!mode || !verifyToken) {
        return res.sendStatus(400);
    }

    if (mode === "subscribe" && verifyToken === process.env.MYTOKEN) {
        console.log("Webhook verified");
        return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
});

// Webhook message handler
app.post("/webhook", async (req, res) => {
    try {
        if (!req.body.object) {
            return res.sendStatus(400);
        }

        const messageData = WhatsAppHandler.extractMessageData(req.body);
        console.log('Received message:', {
            phoneNumberId: messageData.phoneNumberId,
            from: messageData.from,
            message: messageData.messageBody
        });

        // Broadcast message to connected clients
        clientManager.broadcast(messageData);

        // Send echo response
        await WhatsAppHandler.sendMessage(
            messageData.phoneNumberId,
            messageData.from,
            `Echo: ${messageData.messageBody}`
        );

        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.sendStatus(error.message === 'Invalid message format' ? 400 : 500);
    }
});

// SSE endpoint
app.get('/events', (req, res) => {
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const client = { id: Date.now(), res };
    clientManager.addClient(client);

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // Keep-alive ping
    const pingInterval = setInterval(() => {
        if (!res.writableEnded) {
            res.write(': ping\n\n');
        }
    }, 30000);

    // Cleanup on connection close
    req.on('close', () => {
        clearInterval(pingInterval);
        clientManager.removeClient(client);
    });
});

// Home route
app.get("/", (req, res) => {
    res.status(200).send("WhatsApp Webhook Server is running");
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});