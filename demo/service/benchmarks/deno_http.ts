let port = 4500;

console.log(`http listen from: ${port} `);
console.log(`test: wrk --latency -c 100 -t 8 -d 30 http://127.0.0.1:${port}`);

const body = new TextEncoder().encode("Hello World");
for await (const conn of Deno.listen({ port: port })) {
    (async () => {
        for await (const { respondWith } of Deno.serveHttp(conn)) {
            respondWith(new Response(body));
        }
    })();
}

export {};