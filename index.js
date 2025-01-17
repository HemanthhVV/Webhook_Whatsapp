const express = require("express");
const body_parser = require("body-parser");
const axios = require("axios");
const cors = require("cors")

require('dotenv').config();

const app = express().use(body_parser.json());
app.use(cors())

const token = process.env.TOKEN;
const mytoken = process.env.MYTOKEN;//prasath_token


let clients = new Set();

function sendToClients(message) {
    clients.forEach(client => client.res.write(`data: ${JSON.stringify(message)}\n\n`));
}

app.listen(process.env.PORT, () => {
    console.log("webhook is listening");
});

//to verify the callback url from dashboard side - cloud api side
app.get("/webhook", (req, res) => {
    let mode = req.query["hub.mode"];
    let challange = req.query["hub.challenge"];
    let token = req.query["hub.verify_token"];


    if (mode && token) {

        if (mode === "subscribe" && token === mytoken) {
            res.status(200).send(challange);
        } else {
            res.status(403);
        }

    }

});

app.post("/webhook", (req, res) => { //i want some

    let body_param = req.body;

    console.log(JSON.stringify(body_param, null, 4));

    if (body_param.object) {
        console.log("inside body param");
        if (body_param.entry &&
            body_param.entry[0].changes &&
            body_param.entry[0].changes[0].value.messages &&
            body_param.entry[0].changes[0].value.messages[0]
        ) {
            let phon_no_id = body_param.entry[0].changes[0].value.metadata.phone_number_id;
            let from = body_param.entry[0].changes[0].value.messages[0].from;
            let msg_body = body_param.entry[0].changes[0].value.messages

            sendToClients(msg_body)

            console.log("phone number " + phon_no_id);
            console.log("from " + from);
            console.log("body param " + msg_body);

            axios({
                method: "POST",
                url: "https://graph.facebook.com/v21.0/" + phon_no_id + "/messages?access_token=" + token,
                data: {
                    messaging_product: "whatsapp",
                    to: from,
                    text: {
                        body: "Test works\n Echo: " + msg_body
                    }
                },
                headers: {
                    "Content-Type": "application/json"
                }

            });

            res.sendStatus(200);
        } else {
            sendToClients("NOthing")
            res.sendStatus(404);
        }

    }

});

// SSE endpoint
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Add the client to the list of clients
    clients.add({ res });

    // Remove the client when the connection is closed
    req.on('close', () => {
        clients = clients.filter(client => client.res !== res);
    });
    console.log(clients);
});

app.get("/", (req, res) => {
    res.status(200).send("hello this is webhook setup");
});