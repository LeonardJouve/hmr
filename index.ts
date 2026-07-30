import fs from "node:fs/promises";
import path from "node:path";

import {Hono, type MiddlewareHandler} from "hono";
import type {WSContext} from "hono/ws";
import {serve, upgradeWebSocket, type WebSocketLike, type WebSocketServerLike} from "@hono/node-server";
import {serveStatic} from "@hono/node-server/serve-static";
import {WebSocketServer} from "ws";
import chokidar from "chokidar";

const BASE_URL = path.join(process.cwd(), "static");

const app = new Hono();

const hmrMiddleware: MiddlewareHandler = async (c, next) => {
    if (!c.req.path.endsWith(".js")) {
        return await next();
    }

    const client = await fs.readFile(path.join(process.cwd(), "template", "client.js"), "utf-8");
    const content = await fs.readFile(path.join(BASE_URL, c.req.path), "utf-8");

    c.header("Content-Type", "application/javascript");

    return c.body(`
    ${client}

    hmrClient("${new URL(c.req.url).host}", "${c.req.path}");

    ${content}
    `);
};

app.use(hmrMiddleware);

app.use("*", serveStatic({root: BASE_URL}));

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

const watcher = chokidar.watch(BASE_URL, {
    ignored: (path, stats) => Boolean(stats?.isFile() && !path.endsWith('.js')),
});

watcher.on("change", (file) => {
    console.log(`${file} changed`);

    const relative = path.relative(BASE_URL, file);
    sockets.forEach((socket) => socket.send(JSON.stringify({
        type: "file:changed",
        file: `/${relative}`,
    })));
});

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
