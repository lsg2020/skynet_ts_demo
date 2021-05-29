import * as skynet from "skynet"
import { GrpcServer } from "x/grpc_basic/server";
import { Greeter } from "./greeter.d";

const server = new GrpcServer();
const protoFile = await Deno.readTextFile("./demo/service/grpc/greeter.proto");

server.addService<Greeter>(protoFile, {
  async SayHello({ name }) {
    const message = `hello ${name || "stranger"}`;
    return { message };
  },

  async *ShoutHello({ name }) {
    for (const n of [0, 1, 2]) {
      const message = `hello ${name || "stranger"} #${n}`;
      yield { message };
    }
  }
});

skynet.start(async () => {
  let [service_name, port] = JS_INIT_ARGS.split(" ");

  (async () => {
    console.log(`gonna listen on ${port} port`);
    for await (const conn of Deno.listen({ port: Number(port) })) {
      server.handle(conn);
    }
  })();
})

