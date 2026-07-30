import fs from "node:fs/promises";
import path from "node:path";

import {Hono, type MiddlewareHandler} from "hono";
import type {WSContext} from "hono/ws";
import {serve, upgradeWebSocket, type WebSocketLike, type WebSocketServerLike} from "@hono/node-server";
import {serveStatic} from "@hono/node-server/serve-static";
import {WebSocketServer} from "ws";

const STATIC_DIR = path.join(process.cwd(), "static");
const TEMPLATE_DIR = path.join(process.cwd(), "template");

const isHotModuleHandeledFile = (file: string): Boolean => file.endsWith(".js");

const app = new Hono();

const hmrMiddleware: MiddlewareHandler = async (c, next) => {
    if (!isHotModuleHandeledFile(c.req.path)) {
        return await next();
    }

    const client = await fs.readFile(path.join(TEMPLATE_DIR, "client.js"), "utf-8");
    const content = await fs.readFile(path.join(STATIC_DIR, c.req.path), "utf-8");

    c.header("Content-Type", "application/javascript");

    return c.body(`
    ${client}

    hmrClient("${new URL(c.req.url).host}", "${c.req.path}");

    ${content}
    `);
};

app.use(hmrMiddleware);

app.use("*", serveStatic({root: STATIC_DIR}));

const sockets = new Map<string, WSContext<WebSocketLike>>();

app.get(
    "/ws",
    upgradeWebSocket(() => {
        const id = crypto.randomUUID();

        return {
            onOpen: (_, socket) => {
                sockets.set(id, socket);
                console.log(`Connection ${id} opened`);
            },
            onClose: () => {
                sockets.delete(id);
                console.log(`Connection ${id} closed`);
            },
            onError: (e) => console.error(`Error ${id}`, e),
        };
    }),
);

const watch = async () => {
    while (true) {
        const event = await fs.watch(STATIC_DIR, { recursive: true }).next();
        if (event.done) {
            return;
        }

        const {eventType, filename} = event.value;
        if (eventType !== "change" || !filename || !isHotModuleHandeledFile(filename)) {
            continue;
        }

        console.log(`${filename} changed`);

        sockets.forEach((socket) => socket.send(JSON.stringify({
            type: "file:changed",
            file: `/${filename}`,
        })));
    }
};

watch();

const wss = new WebSocketServer({noServer: true}) as WebSocketServerLike;

const server = serve({
    fetch: app.fetch,
    websocket: {server: wss},
    port: 3000,
}, ({port}) => console.log(`Listening on port ${port}...`));

process.on("SIGINT", () => {
    server.close();
    process.exit(0);
});

process.on("SIGTERM", () => {
    server.close((err) => {
        if (err) {
            console.error(err);
            process.exit(1);
        }
        process.exit(0);
    });
});
